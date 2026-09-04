import type { TopicId } from "@guessly/protocol";

/**
 * Finding pictures that exist — anywhere.
 *
 * The generator cannot browse, and a URL it writes from memory is usually a
 * wish rather than a file. So every URL it submits has to come out of a
 * lookup, and this module is that lookup's one front door: `searchImages`
 * asks every provider that applies at once, merges what they found into one
 * list the model reads, and `formatImageResults` writes that list out with
 * the URL last on every line so it is the thing to copy.
 *
 * The providers are worth different things and fail differently, which is
 * why there are several and why they are merged rather than tried in turn:
 *
 * - **The web** (`serper.ts`) is the only source with a frame from a film, a
 *   gameplay screenshot of a console game or the swoosh on its own — the game
 *   is non-commercial and serves every picture from its own host, so where a
 *   file came from stops mattering the moment it has been downloaded.
 * - **Steam** (`steam.ts`) holds the publisher's own screenshots of most PC
 *   games, keyless, at 1920×1080; they lead the list on a games round because
 *   a screenshot is what that round should show.
 * - **Wikipedia and Commons** (`wikimedia.ts`) are guaranteed to be *about*
 *   the subject and are the only source that needs no key at all, so a fill
 *   run with nothing configured still works the way it always did.
 *
 * What none of them do is *choose*. A tool that picked would have to know
 * that a wordmark ruins a logo round and that box art is not a screenshot —
 * judgements the prompt makes and an API cannot. The vision check in
 * `vision.ts` is the other half of that split: it looks at what was chosen
 * after the fact, which is the one place a bad choice can still be caught.
 */

/** Where a candidate came from — read by the model off the tag on its line. */
export type ImageSource = "steam" | "web" | "wikipedia" | "commons";

export interface FoundImage {
  source: ImageSource;
  /** What the model reads as the name: a file title, a page title. */
  label: string;
  /** Ready to submit, verbatim. */
  url: string;
  /** Null when the source did not say; the download sniffs the bytes anyway. */
  mime: string | null;
  /** Zero when the source did not say. */
  width: number;
  height: number;
  /** A caption or a snippet, trimmed to a line. Null when there is none. */
  description: string | null;
  /**
   * The page the picture was found on, sent as the Referer when the file is
   * downloaded — a CDN that checks one wants the page the picture belongs to.
   * Null for a file whose host asks for nothing of the kind.
   */
  page: string | null;
  /** The host it lives on, for the model to read: "ign.com". Null when the source says it. */
  site: string | null;
}

/** What the model asked for, as every provider reads it. */
export interface ImageQuery {
  /** The subject's plain English name: "Portal 2", "Red panda". */
  subject: string;
  /** What kind of picture, when the model said: "gameplay screenshot". Null otherwise. */
  lookingFor: string | null;
  topic: TopicId;
}

/**
 * One place pictures come from. `null` from `search` means the provider could
 * not be reached, which is a different thing from an empty list: the model is
 * told an archive holds nothing, and told a lookup failed, in different words.
 */
export interface ImageProvider {
  /** Names the provider in the log's per-search tally. */
  readonly name: string;
  /**
   * `lead` results are listed before everything else, in their own order —
   * Steam's screenshots on a games round. `lane` results are interleaved with
   * the other lanes, so no single source can spend the whole list.
   */
  readonly placement: "lead" | "lane";
  /**
   * How many of a lane's results go into the list per turn of the
   * interleave. One unless the source is worth more of the list than the
   * others: the web's ten are ten pictures *of the subject* where an
   * article's ten are the producer, the premiere and an infobox icon.
   */
  readonly weight?: number;
  /** Whether this provider has anything to say about the topic at all. */
  appliesTo(topic: TopicId): boolean;
  search(query: ImageQuery, signal: AbortSignal): Promise<FoundImage[] | null>;
}

/** Search results, or the sentence the model is told instead. */
export type ImageSearchResult =
  | {
      ok: true;
      images: FoundImage[];
      /** What each provider that was asked came back with: a count, or null if it could not be reached. */
      counts: Record<string, number | null>;
    }
  | { ok: false; reason: string };

/** How many files come back from one search: enough to choose from, short enough to read. */
export const MAX_RESULTS = 15;

/** The subject with the kind of picture appended — what a full-text search is asked. */
export const fullQuery = (query: ImageQuery): string =>
  query.lookingFor ? `${query.subject} ${query.lookingFor}` : query.subject;

/**
 * Everything every applicable provider has for one subject, merged.
 *
 * Failure is a sentence rather than a throw: a lookup that did not answer is
 * the model's to route around, with a different query or a different
 * subject, and killing the generation over it would trade a slightly worse
 * round for no round. Only when *every* provider asked was unreachable is the
 * whole search reported as failed.
 */
export async function searchImages(
  query: ImageQuery,
  providers: readonly ImageProvider[],
  signal: AbortSignal,
): Promise<ImageSearchResult> {
  const subject = query.subject.trim();
  if (!subject) return { ok: false, reason: "The query was empty." };
  const cleaned: ImageQuery = {
    subject,
    lookingFor: query.lookingFor?.trim() || null,
    topic: query.topic,
  };

  const asked = providers.filter((provider) => provider.appliesTo(cleaned.topic));
  const answers = await Promise.all(asked.map((provider) => provider.search(cleaned, signal)));

  const counts: Record<string, number | null> = {};
  const lead: FoundImage[] = [];
  const lanes: Lane[] = [];
  asked.forEach((provider, index) => {
    const found = answers[index] ?? null;
    counts[provider.name] = found === null ? null : found.length;
    if (found === null) return;
    if (provider.placement === "lead") lead.push(...found);
    else lanes.push({ images: found, weight: provider.weight ?? 1 });
  });

  if (asked.length > 0 && Object.values(counts).every((count) => count === null)) {
    return { ok: false, reason: "The image search could not be reached." };
  }

  return { ok: true, images: merge(lead, lanes, MAX_RESULTS), counts };
}

/** One interleaved source: its results, and how many of them each turn takes. */
export interface Lane {
  images: readonly FoundImage[];
  weight: number;
}

/**
 * The lead first, then the lanes in turn — each contributing its weight's
 * worth per turn — deduplicated by URL: a file the article uses *and* the
 * search finds is one file, offered through whichever came round first.
 * Exported for its own test: the alternation is the whole point of it.
 * Filling from one source first used to spend the whole list on twelve
 * incidental photographs off an article while the shot the other source had
 * ranked first was never shown.
 */
export function merge(lead: readonly FoundImage[], lanes: readonly Lane[], limit: number): FoundImage[] {
  const seen = new Set<string>();
  const out: FoundImage[] = [];

  const take = (image: FoundImage | undefined): void => {
    if (!image || out.length >= limit) return;
    const key = image.url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(image);
  };

  for (const image of lead) take(image);

  const cursors = lanes.map(() => 0);
  const exhausted = (): boolean => lanes.every((lane, index) => cursors[index]! >= lane.images.length);
  while (out.length < limit && !exhausted()) {
    lanes.forEach((lane, index) => {
      let cursor = cursors[index]!;
      for (let taken = 0; taken < Math.max(1, lane.weight); taken += 1) {
        take(lane.images[cursor]);
        cursor += 1;
      }
      cursors[index] = cursor;
    });
  }
  return out;
}

/** The tag at the front of a result line, which is how the model tells a screenshot from an archive. */
function sourceTag(image: FoundImage): string {
  switch (image.source) {
    case "steam":
      return "Steam screenshot";
    case "web":
      return image.site ? `web: ${image.site}` : "web";
    case "wikipedia":
      return "Wikipedia";
    case "commons":
      return "Commons";
  }
}

/**
 * The results as the model reads them: one line per file, the URL last so it
 * is the thing to copy. The dimensions are there because they are how a
 * photograph is told from a thumbnail, the caption because it is how a
 * screenshot is told from a logo without opening either, and the source tag
 * because a Steam screenshot needs no caption to be trusted as one.
 */
export function formatImageResults(result: ImageSearchResult, query: ImageQuery): string {
  const asked = fullQuery(query);
  if (!result.ok) {
    return `${result.reason} Try a different query, or a subject you can source another way.`;
  }
  if (result.images.length === 0) {
    return `No pictures found for "${asked}". Try the subject's plain English name, a different looking_for, or pick a different subject.`;
  }

  const lines = result.images.map((image) => {
    const size = image.width > 0 && image.height > 0 ? ` (${image.width}×${image.height})` : "";
    const caption = image.description ? ` — ${image.description}` : "";
    return `- [${sourceTag(image)}] ${image.label}${size}${caption}\n  ${image.url}`;
  });

  return [
    `${result.images.length} picture(s) found for "${asked}". These URLs are real — copy the ones you pick into image_urls verbatim, best first.`,
    ...lines,
    "Pick pictures that show the subject large and plain with nothing on them that spells the answer out — every download is checked for that, and one that fails costs the attempt. A game is a gameplay screenshot, never its cover. If none fit, search again with a different looking_for, or a different subject.",
  ].join("\n");
}
