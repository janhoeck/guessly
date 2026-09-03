import { USER_AGENT } from "./download.js";

/**
 * Finding pictures that exist.
 *
 * The generator cannot browse, and for a long time that was taken to mean the
 * file names had to come out of its memory — the prompt steered it toward
 * canonical, rule-based names and the download check caught the rest. That
 * works exactly as far as the rules go. `Flag of France.svg` is a rule;
 * `Minecraft screenshot.png` is a wish, and the file the article actually uses
 * is `Screenshot from the Minecraft Nether.png`, which nothing but a lookup
 * was ever going to produce. Whole topics were unfillable for that reason
 * alone: three attempts, five invented URLs each, ten minutes, and a bench.
 *
 * MediaWiki's API answers the lookup, needs no key, and is the same host the
 * bytes come from — so the model gets a search tool after all. It does not
 * *choose* the picture: it hands back real titles with their real sizes and
 * captions, and the model picks the one that shows the subject without
 * spelling it out. That split is the point. A tool that picked would have to
 * know that a wordmark ruins a logo round; a model that invents file names
 * cannot be told anything that makes it stop.
 *
 * Two questions are asked at once, because they fail differently:
 *
 * - **What is on the subject's English Wikipedia article** — everything there
 *   is about the subject, so the hit rate is high and the noise is wiki
 *   furniture, which is filtered by name and by size.
 * - **What Commons holds under that name** — wider, and the only source for
 *   subjects with no article of their own.
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

/** The render width every candidate URL asks for. */
const RENDER_WIDTH = 1200;

/** A lookup is a formality next to a ten-minute generation; it does not get to hang. */
const API_TIMEOUT_MS = 10_000;

/** How many files come back from one search: enough to choose from, short enough to read. */
const MAX_RESULTS = 12;

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
  ].join("|"),
  "i",
);

export interface FoundImage {
  /** The exact file title, without the `File:` prefix. */
  name: string;
  /** Which wiki's `Special:FilePath` resolves it. */
  wiki: WikiId;
  /** Ready to submit, verbatim. */
  url: string;
  mime: string;
  width: number;
  height: number;
  /** The file's caption, trimmed to a line. Null when it has none. */
  description: string | null;
}

/** Search results, or the sentence the model is told instead. */
export type ImageSearchResult =
  | { ok: true; images: FoundImage[] }
  | { ok: false; reason: string };

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
      name,
      wiki,
      url: fileUrl(wiki, name),
      mime: info.mime,
      width,
      height,
      description: plainDescription(info.extmetadata?.ImageDescription?.value),
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
    const haystack = `${image.name} ${image.description ?? ""}`.toLowerCase();
    return words.some((word) => haystack.includes(word)) ? 0 : 1;
  };
  return [...images].sort((a, b) => mentions(a) - mentions(b));
}

/**
 * Everything both wikis have for one subject, the two sources interleaved.
 *
 * They are worth different things and both are worth something. The article's
 * images are guaranteed to be *about* the subject — a Commons text search for
 * "Mercury" will happily return a thermometer — while the search is ranked by
 * relevance and is the only source at all for a subject with no article of its
 * own. Filling from the article first turned out to spend the whole result list
 * on one of them: twelve incidental photographs off the "Among Us" article, and
 * the cosplay shot Commons had ranked first never shown. So they alternate, and
 * whichever runs out first leaves its slots to the other.
 *
 * Failure is a sentence rather than a throw: a lookup that did not answer is
 * the model's to route around, with a different query or a different subject,
 * and killing the generation over it would trade a slightly worse round for no
 * round.
 */
export async function searchImages(
  query: string,
  signal: AbortSignal,
): Promise<ImageSearchResult> {
  const subject = query.trim();
  if (!subject) return { ok: false, reason: "The query was empty." };

  const [article, commons] = await Promise.all([
    callApi(
      "en",
      {
        titles: subject,
        redirects: "1",
        generator: "images",
        gimlimit: String(ARTICLE_IMAGE_LIMIT),
      },
      signal,
    ),
    callApi(
      "commons",
      {
        generator: "search",
        gsrsearch: subject,
        gsrnamespace: "6",
        gsrlimit: String(COMMONS_SEARCH_LIMIT),
      },
      signal,
    ),
  ]);

  if (article === null && commons === null) {
    return { ok: false, reason: "The image search could not be reached." };
  }

  return {
    ok: true,
    images: interleave(
      preferNamed(parseImagePages(article, "en"), subject),
      parseImagePages(commons, "commons"),
      MAX_RESULTS,
    ),
  };
}

/**
 * One from each in turn, deduplicated by file name — a file used on the article
 * *and* found by the search is one file, offered through whichever came round
 * first. Exported for its own test: the alternation is the whole point of it.
 */
export function interleave(
  first: readonly FoundImage[],
  second: readonly FoundImage[],
  limit: number,
): FoundImage[] {
  const seen = new Set<string>();
  const out: FoundImage[] = [];

  const take = (image: FoundImage | undefined): void => {
    if (!image || out.length >= limit) return;
    const key = image.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(image);
  };

  for (let index = 0; out.length < limit && index < Math.max(first.length, second.length); index += 1) {
    take(first[index]);
    take(second[index]);
  }
  return out;
}

/**
 * The results as the model reads them: one line per file, the URL last so it is
 * the thing to copy. The dimensions are there because they are how a photograph
 * is told from a thumbnail, and the caption because it is how a screenshot is
 * told from a logo without opening either.
 */
export function formatImageResults(result: ImageSearchResult, query: string): string {
  if (!result.ok) {
    return `${result.reason} Try a different query, or a subject you can source another way.`;
  }
  if (result.images.length === 0) {
    return `No image files found for "${query}". The open archives may hold nothing for it — try the subject's plain English name, or pick a different subject.`;
  }

  const lines = result.images.map((image) => {
    const caption = image.description ? ` — ${image.description}` : "";
    return `- ${image.name} (${image.width}×${image.height})${caption}\n  ${image.url}`;
  });

  return [
    `${result.images.length} file(s) exist for "${query}". These URLs are real — copy the ones you pick into image_urls verbatim, best first.`,
    ...lines,
    "Pick pictures that show the subject large and plain and do not spell its name out. If none of them do, search a different subject.",
  ].join("\n");
}
