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
 *
 * Since the search reaches past Wikimedia, the download has to as well, and
 * the web is less polite than an archive: a CDN that serves a page's pictures
 * often refuses a request that does not look like that page's browser asking.
 * So the headers depend on the host — see `headersFor`.
 */

/** Wikimedia refuses anonymous user agents outright, and asks for a descriptive
 *  one — for its API in wikimedia.ts as much as for the bytes here. */
export const USER_AGENT =
  "Guessly/0.1 (multiplayer guessing game; +https://github.com/guessly) node-fetch";

/**
 * What everywhere else gets. A stock browser string, because a hotlink check
 * is a check on whether the request looks like a browser, and this download
 * is doing exactly what a browser would: fetching a picture a page shows.
 */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const WIKIMEDIA_HOST = /(^|\.)(wikimedia|wikipedia)\.org$/i;

/**
 * The request headers for one URL. Wikimedia gets the agent its policy asks
 * for and no referer; every other host gets a browser's agent and, when the
 * search said which page the picture was found on, that page as the referer.
 * Exported for its own test: it is a rule, and a rule is argued in a test.
 */
export function headersFor(url: string, referer: string | null): Record<string, string> {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // Not a URL; the fetch will say so. Browser headers do no harm meanwhile.
  }
  if (WIKIMEDIA_HOST.test(host)) {
    return { "user-agent": USER_AGENT, accept: "image/*" };
  }
  return {
    "user-agent": BROWSER_USER_AGENT,
    accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    ...(referer ? { referer } : {}),
  };
}

export interface DownloadedImage {
  bytes: Buffer;
  /** Determined from the bytes, not from the server's header. */
  contentType: string;
  extension: string;
  /** Where it came from. Kept for attribution; never what the players load. */
  sourceUrl: string;
}

export interface DownloadOptions {
  /** The page the picture was found on, if the search said. */
  referer?: string | null;
  /** A host that cannot deliver the whole file in this long will not do better later. */
  timeoutMs: number;
}

/** One download: the whole file, capped, sniffed. Null on anything less. */
export async function downloadImage(
  url: string,
  signal: AbortSignal,
  options: DownloadOptions,
): Promise<DownloadedImage | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: headersFor(url, options.referer ?? null),
      signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
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
