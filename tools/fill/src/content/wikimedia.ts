import { USER_AGENT } from "./download.js";
import type { FoundImage, ImageProvider, ImageQuery } from "./search.js";

/**
 * The open archives: what the subject's English Wikipedia article shows, and
 * what Commons holds under its name.
 *
 * MediaWiki's API answers both, needs no key, and is the same host the bytes
 * come from — which is why this was the first lookup the generator got and
 * why it is the one that still works when nothing else is configured. The
 * two are two providers rather than one because they fail differently and
 * are worth different things:
 *
 * - **The article's images** are guaranteed to be *about* the subject, so
 *   the hit rate is high and the noise is wiki furniture, which is filtered
 *   by name and by size. `generator=images` has no ranking to give, so naming
 *   the subject is used as the one relevance signal available without another
 *   request.
 * - **The Commons search** is wider and ranked by relevance, and is the only
 *   archive at all for a subject with no article of its own — at the price
 *   that a text search for "Mercury" will happily return a thermometer.
 *
 * Both hand back real titles with their real sizes and captions; the model
 * picks the one that shows the subject without spelling it out.
 */

const ENDPOINTS = {
  commons: "https://commons.wikimedia.org/w/api.php",
  en: "https://en.wikipedia.org/w/api.php",
} as const;

export type WikiId = keyof typeof ENDPOINTS;

const FILE_PATH_BASE: Record<WikiId, string> = {
  commons: "https://commons.wikimedia.org/wiki/Special:FilePath/",
  // en.wikipedia's own FilePath resolves Commons files too, so an article's
  // images all work through it whether they are local to it or not.
  en: "https://en.wikipedia.org/wiki/Special:FilePath/",
};

const SOURCE: Record<WikiId, FoundImage["source"]> = { commons: "commons", en: "wikipedia" };

/**
 * The render width every candidate URL asks for. It is also what turns an SVG
 * — a flag, a logo — into a PNG on the way out, which is the only form the
 * vision check can read.
 */
const RENDER_WIDTH = 1200;

/** A lookup is a formality next to a ten-minute generation; it does not get to hang. */
const API_TIMEOUT_MS = 10_000;

const COMMONS_SEARCH_LIMIT = 20;
const ARTICLE_IMAGE_LIMIT = 50;

/**
 * Below this on either axis it is an icon, not a picture. Wiki furniture is
 * 20–50px; the smallest real photograph on Commons is far above this, and an
 * SVG's nominal size is its artboard, which for a flag or a logo is hundreds.
 */
const MIN_DIMENSION = 150;

/**
 * Wikipedia's own furniture, which `generator=images` returns alongside an
 * article's actual pictures: sister-project logos, maintenance banners,
 * interface icons, audio-file glyphs. Matched on the file name, because that
 * is the only thing about them that is stable.
 */
const CHROME = new RegExp(
  [
    "^(commons|wikipedia|wikimedia|wiktionary)[- ]?logo",
    "^wiki(books|news|quote|source|versity|voyage|data|species)",
    "^(oojs|ooui) ",
    "^symbol ",
    "^(ambox|imbox|cmbox|tmbox|ombox)",
    "^(semi-)?protection",
    "^(padlock|disambig|question book|edit-|folder|magnify-clip|nuvola|crystal|gnome-|emblem-|p vip|portal-puzzle)",
    "^(increase|decrease|steady)\\b",
    "^(red|blue|green|yellow|black|white) pog",
    "^(text document|office-book|speakerlink|loudspeaker|sound-icon)",
    "^wpvg icon",
    "^masked man\\b",
    "^star (full|half|empty)",
    "^(cscr|searchtool|merge-arrow|arrow blue)",
    // Icon sets an infobox borrows a glyph from: a phone, a duplicate sign.
    "^noun[- ]",
    "^(ionicons|octicons|font ?awesome|material design|feather|tabler)\\b",
  ].join("|"),
  "i",
);

const fileUrl = (wiki: WikiId, name: string): string =>
  `${FILE_PATH_BASE[wiki]}${encodeURIComponent(name)}?width=${RENDER_WIDTH}`;

/**
 * Commons captions are HTML — links, language spans, the odd table. The model
 * needs the sentence, not the markup, and a long one is a page of provenance
 * nobody is choosing a picture by.
 */
function plainDescription(html: unknown): string | null {
  if (typeof html !== "string") return null;
  const entities: Record<string, string> = {
    nbsp: " ",
    amp: "&",
    quot: '"',
    "#39": "'",
    lt: "<",
    gt: ">",
  };
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/g, (_, entity: string) => entities[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/**
 * One API page list, read into candidates. Exported for its own test: this is
 * where a real payload becomes what the model is shown, and everything refused
 * here — a sound file, a maintenance icon, a 20px glyph — is refused because
 * it would otherwise read like a picture of the subject.
 */
export function parseImagePages(payload: unknown, wiki: WikiId): FoundImage[] {
  const pages = (payload as { query?: { pages?: unknown } } | undefined)?.query?.pages;
  if (!Array.isArray(pages)) return [];

  // `generator=search` returns its ranking in `index` rather than in the array
  // order, and the ranking is the whole value of a search.
  const ranked = [...pages].sort(
    (a, b) =>
      (Number((a as { index?: number }).index) || 0) - (Number((b as { index?: number }).index) || 0),
  );

  const out: FoundImage[] = [];
  for (const page of ranked) {
    const record = page as {
      title?: unknown;
      imageinfo?: {
        width?: number;
        height?: number;
        mime?: string;
        extmetadata?: Record<string, { value?: unknown }>;
      }[];
    };
    if (typeof record.title !== "string") continue;
    const name = record.title.replace(/^File:/i, "").trim();
    if (!name || CHROME.test(name)) continue;

    // No imageinfo means there is no file record to judge — a deleted entry,
    // or one this wiki only links to — and an unjudgeable file is not offered.
    const info = record.imageinfo?.[0];
    if (!info || typeof info.mime !== "string" || !info.mime.startsWith("image/")) continue;

    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    if (width < MIN_DIMENSION || height < MIN_DIMENSION) continue;

    out.push({
      source: SOURCE[wiki],
      label: name,
      url: fileUrl(wiki, name),
      mime: info.mime,
      width,
      height,
      description: plainDescription(info.extmetadata?.ImageDescription?.value),
      page: null,
      site: null,
    });
  }
  return out;
}

async function callApi(
  wiki: WikiId,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown | null> {
  const url = new URL(ENDPOINTS[wiki]);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "imageinfo",
    iiprop: "size|mime|extmetadata",
    iiextmetadatafilter: "ImageDescription",
    ...params,
  }).toString();

  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** The words of a query worth matching a file name against. */
const queryWords = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3);

/**
 * An article's images come back in no useful order — `generator=images` has no
 * ranking to give — and an article carries plenty that is not the subject: the
 * developer's office, a voice actor, a related species. Naming the subject is
 * the one relevance signal available without another request, and it is a good
 * one: "Pyrkon 2022 - Among Us cosplay.jpg" beats the trash bin the article
 * also happens to cite. Stable, so files that match equally keep their order.
 */
function preferNamed(images: FoundImage[], query: string): FoundImage[] {
  const words = queryWords(query);
  if (words.length === 0) return images;
  const mentions = (image: FoundImage): number => {
    const haystack = `${image.label} ${image.description ?? ""}`.toLowerCase();
    return words.some((word) => haystack.includes(word)) ? 0 : 1;
  };
  return [...images].sort((a, b) => mentions(a) - mentions(b));
}

/** What the subject's English Wikipedia article shows. Asked by the subject's name alone: it is a title lookup. */
export function createWikipediaProvider(): ImageProvider {
  return {
    name: "wikipedia",
    placement: "lane",
    appliesTo: () => true,
    async search(query: ImageQuery, signal) {
      const payload = await callApi(
        "en",
        {
          titles: query.subject,
          redirects: "1",
          generator: "images",
          gimlimit: String(ARTICLE_IMAGE_LIMIT),
        },
        signal,
      );
      if (payload === null) return null;
      return preferNamed(parseImagePages(payload, "en"), query.subject);
    },
  };
}

/**
 * What Commons holds under the subject's name. The subject alone, not the
 * kind of picture asked for: Commons' full-text search is a search of file
 * pages, and "Portal 2 gameplay screenshot" matched nothing where "Portal 2"
 * matched plenty. `looking_for` is the web search's to act on.
 */
export function createCommonsProvider(): ImageProvider {
  return {
    name: "commons",
    placement: "lane",
    appliesTo: () => true,
    async search(query: ImageQuery, signal) {
      const payload = await callApi(
        "commons",
        {
          generator: "search",
          gsrsearch: query.subject,
          gsrnamespace: "6",
          gsrlimit: String(COMMONS_SEARCH_LIMIT),
        },
        signal,
      );
      if (payload === null) return null;
      return parseImagePages(payload, "commons");
    },
  };
}
