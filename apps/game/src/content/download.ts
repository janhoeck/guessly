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
 */

/** Wikimedia refuses anonymous user agents outright, and it is the best host we have. */
const USER_AGENT =
  "Guessly/0.1 (multiplayer guessing game; +https://github.com/guessly) node-fetch";

/** Big enough for any 1200px Commons render, small enough to refuse an archive scan. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface DownloadedImage {
  bytes: Buffer;
  /** Determined from the bytes, not from the server's header. */
  contentType: string;
  extension: string;
  /** Where it came from. Kept for attribution; never what the players load. */
  sourceUrl: string;
}

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0): boolean =>
  prefix.every((expected, index) => bytes[offset + index] === expected);

/**
 * What image format these bytes are, by their magic numbers — the one thing an
 * error page served with `content-type: image/png` cannot fake.
 */
export function sniffImage(
  bytes: Uint8Array,
): { contentType: string; extension: string } | null {
  if (bytes.length < 12) return null;

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) {
    return { contentType: "image/png", extension: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return { contentType: "image/gif", extension: "gif" };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { contentType: "image/webp", extension: "webp" };
  }

  // SVG is text, so the check is for a document that *is* an svg element —
  // not merely one that contains one, which every HTML error page with an
  // inline icon does.
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.slice(0, 1024))
    .trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return { contentType: "image/svg+xml", extension: "svg" };
  }

  return null;
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
