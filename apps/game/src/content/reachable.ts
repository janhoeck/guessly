/**
 * "Does this URL actually serve a picture?"
 *
 * The model is asked for three candidates and is right about most of them, but
 * a dead link is a blank plate in front of twelve people who cannot do anything
 * about it, and the round is only twenty seconds long. So each candidate is
 * tried here first and the first one that answers with an image wins.
 *
 * This is a good check and not a guarantee: the browser is the one that will
 * actually load the picture, and a host can serve the server and still refuse a
 * cross-origin request from a player. That last mile is the client's `onError`.
 */

/** Wikimedia refuses anonymous user agents outright, and it is the best host we have. */
const USER_AGENT =
  "Guessly/0.1 (multiplayer guessing game; +https://github.com/guessly) node-fetch";

const isImage = (response: Response): boolean =>
  response.ok && (response.headers.get("content-type") ?? "").toLowerCase().startsWith("image/");

/**
 * HEAD first because it costs nothing, then a one-byte ranged GET, because a
 * surprising number of CDNs answer HEAD with 403 or 405 while happily serving
 * the file itself.
 */
async function probe(url: string, signal: AbortSignal): Promise<boolean> {
  const headers = { "user-agent": USER_AGENT, accept: "image/*" };

  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", headers, signal });
    if (isImage(head)) return true;
    if (head.status !== 403 && head.status !== 405 && head.status !== 501) return false;
  } catch {
    // Fall through to the ranged GET: a connection reset on HEAD is not proof
    // the file is missing.
  }

  try {
    const ranged = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { ...headers, range: "bytes=0-0" },
      signal,
    });
    // Read nothing: the headers are the whole answer, and leaving the body
    // undrained would hold the socket open for the rest of the round.
    await ranged.body?.cancel();
    return isImage(ranged);
  } catch {
    return false;
  }
}

/**
 * Candidates in the model's own order — it was asked for best first — and the
 * first that answers wins. Sequential rather than parallel on purpose: the usual
 * case is that the first URL is fine, and three simultaneous requests to three
 * strangers' servers to throw two away is not a nicer thing to do.
 */
export async function firstReachableImage(
  urls: readonly string[],
  signal: AbortSignal,
  perUrlTimeoutMs: number,
): Promise<string | null> {
  for (const url of urls) {
    if (signal.aborted) return null;
    const attempt = AbortSignal.any([signal, AbortSignal.timeout(perUrlTimeoutMs)]);
    if (await probe(url, attempt)) return url;
  }
  return null;
}
