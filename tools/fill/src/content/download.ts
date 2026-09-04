import { MAX_IMAGE_BYTES, sniffImage } from "@guessly/bank";

/**
 * Fetching the actual bytes of a candidate image.
 *
 * This game used to probe a URL (HEAD, then a one-byte GET) and then hand it to
 * twelve browsers to fetch for themselves — which meant the round depended on a
 * stranger's server staying alive, allowing hotlinks and answering CORS for the
 * whole twenty seconds. Now the server downloads the picture once, verifies it
 * is a picture by looking at its bytes rather than trusting a content-type
 * header, and the bank serves it from our own origin. The only host that has to
 * stay up for a round is ours.
 *
 * The verification itself — `sniffImage`, and the size it is capped at — lives
 * in the bank, because the admin's upload has to pass the same check: what the
 * bank will hold is the bank's rule, not the downloader's.
 */

/** Wikimedia refuses anonymous user agents outright, and it is the best host we
 *  have — for its API in wikimedia.ts as much as for the bytes here. */
export const USER_AGENT =
  "Guessly/0.1 (multiplayer guessing game; +https://github.com/guessly) node-fetch";

export interface DownloadedImage {
  bytes: Buffer;
  /** Determined from the bytes, not from the server's header. */
  contentType: string;
  extension: string;
  /** Where it came from. Kept for attribution; never what the players load. */
  sourceUrl: string;
}

/** One download: the whole file, capped, sniffed. Null on anything less. */
async function downloadImage(url: string, signal: AbortSignal): Promise<DownloadedImage | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "image/*" },
      signal,
    });
    if (!response.ok || response.body === null) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      // Returning mid-iteration cancels the stream; nothing is left dangling.
      if (total > MAX_IMAGE_BYTES) return null;
      chunks.push(chunk);
    }

    const bytes = Buffer.concat(chunks);
    const sniffed = sniffImage(bytes);
    if (!sniffed) return null;
    return { bytes, ...sniffed, sourceUrl: url };
  } catch {
    return null;
  }
}

/**
 * Candidates in the model's own order — it was asked for best first — and the
 * first that turns out to actually be an image wins. Sequential, unlike the
 * one-byte probes this replaced: these are whole files, and a dead URL fails
 * fast anyway — only a *hanging* host costs its timeout, and that is what the
 * per-URL budget is for.
 */
export async function firstDownloadableImage(
  urls: readonly string[],
  signal: AbortSignal,
  perUrlTimeoutMs: number,
): Promise<DownloadedImage | null> {
  for (const url of urls) {
    if (signal.aborted) return null;
    const attempt = AbortSignal.any([signal, AbortSignal.timeout(perUrlTimeoutMs)]);
    const image = await downloadImage(url, attempt);
    if (image) return image;
  }
  return null;
}
