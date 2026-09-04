import { USER_AGENT } from "./download.js";
import { fullQuery, type FoundImage, type ImageProvider } from "./search.js";

/**
 * The web, as Google Images sees it, through serper.dev.
 *
 * This is the provider that makes "any site" true. It is a third party
 * rather than Google itself because Google's own Programmable Search Engine
 * stopped offering "search the entire web" to new engines in January 2026 —
 * fifty named domains is the most a new one will search, and the existing
 * whole-web engines are switched off at the start of 2027 — and a
 * fifty-domain list can only approximate what this gives: the frame from
 * the film, the gameplay screenshot of a console game, the logo without the
 * wordmark, from wherever on the web it happens to be. Serper runs the
 * Google Images query and returns the results as JSON. It is unofficial in
 * the sense that Google is not the one answering, and it is metered — a few
 * thousand free queries on signup, fractions of a cent each after — so the
 * provider is optional, and the fill tool without it is the fill tool as it
 * was.
 *
 * Quota is the one failure worth handling specially: an account out of
 * credits is refused on every request until somebody tops it up, and asking
 * again every round would log an error a minute. So a 4xx that means "not
 * you, not now" benches the provider for an hour, once, and the other
 * sources carry on. Anything else unreachable is a null answer, which the
 * merge treats as "did not answer" rather than "found nothing".
 */

const ENDPOINT = "https://google.serper.dev/images";

/** A lookup is a formality next to a ten-minute generation; it does not get to hang. */
const API_TIMEOUT_MS = 10_000;

/** Enough to choose from; the merge caps the whole list anyway. */
const RESULTS_PER_QUERY = 12;

/**
 * Below this on either axis it is a thumbnail. The web is full of 200px
 * previews of the real picture, and one of those on a wall of twelve phones
 * is a smudge. A result that does not say its size is kept: the download and
 * the vision check both stand behind this filter.
 */
const MIN_DIMENSION = 400;

const QUOTA_PAUSE_MS = 60 * 60_000;

/** Refused because of the account, not the query: a bad key, no credits, too fast. */
const ACCOUNT_STATUSES = new Set([401, 402, 403, 429]);

/** "www.ign.com" reads as "ign.com" to the model and to anybody. */
const bareHost = (host: unknown): string | null => {
  if (typeof host !== "string") return null;
  const bare = host.trim().replace(/^www\./i, "");
  return bare || null;
};

const line = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * One response's images, read into candidates. Exported for its own test:
 * this is where a real payload becomes what the model is shown, and a
 * thumbnail or a plain-http file is refused here rather than downloaded and
 * found out.
 */
export function parseSerperResults(payload: unknown): FoundImage[] {
  const images = (payload as { images?: unknown } | undefined)?.images;
  if (!Array.isArray(images)) return [];

  const out: FoundImage[] = [];
  for (const item of images) {
    const record = item as {
      imageUrl?: unknown;
      imageWidth?: unknown;
      imageHeight?: unknown;
      title?: unknown;
      source?: unknown;
      domain?: unknown;
      link?: unknown;
    };
    if (typeof record.imageUrl !== "string") continue;
    let url: URL;
    try {
      url = new URL(record.imageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;

    const width = Number(record.imageWidth) || 0;
    const height = Number(record.imageHeight) || 0;
    const sized = width > 0 && height > 0;
    if (sized && (width < MIN_DIMENSION || height < MIN_DIMENSION)) continue;

    const page = typeof record.link === "string" && record.link.startsWith("http") ? record.link : null;
    let pageHost: string | null = null;
    if (page) {
      try {
        pageHost = new URL(page).hostname;
      } catch {
        // The picture is still a picture; the host is only for the label.
      }
    }

    out.push({
      source: "web",
      label: line(record.title, 90) ?? url.pathname.split("/").pop() ?? url.href,
      url: url.href,
      mime: null,
      width: sized ? width : 0,
      height: sized ? height : 0,
      description: line(record.source, 80),
      page,
      site: bareHost(record.domain) ?? bareHost(pageHost) ?? bareHost(url.hostname),
    });
  }
  return out;
}

/** The API's own account of what went wrong, if the body carried one. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof body.message === "string") return body.message;
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON; the status is all there is.
  }
  return `HTTP ${response.status}`;
}

export function createSerperProvider(
  apiKey: string,
  options: { now?: () => number } = {},
): ImageProvider {
  const now = options.now ?? Date.now;
  let pausedUntil = 0;

  return {
    name: "web",
    placement: "lane",
    // Two of the list's slots per turn where the archives get one: ten web
    // results are ten pictures of the subject, where an article's ten are
    // the producer, the premiere and an infobox icon.
    weight: 2,
    appliesTo: () => true,
    async search(query, signal) {
      if (now() < pausedUntil) return null;

      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": USER_AGENT,
          },
          body: JSON.stringify({ q: fullQuery(query), num: RESULTS_PER_QUERY, gl: "us", hl: "en" }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
        });
      } catch {
        return null;
      }

      if (ACCOUNT_STATUSES.has(response.status)) {
        pausedUntil = now() + QUOTA_PAUSE_MS;
        console.warn(
          `[content] Serper image search refused (${await errorMessage(response)}) — resting it for an hour; the other sources carry on`,
        );
        return null;
      }
      if (!response.ok) return null;

      try {
        return parseSerperResults((await response.json()) as unknown);
      } catch {
        return null;
      }
    },
  };
}
