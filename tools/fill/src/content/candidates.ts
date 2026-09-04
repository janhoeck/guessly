import type { DownloadedImage } from "./download.js";
import type { FoundImage } from "./search.js";
import type { ImageJudge, JudgeContext } from "./vision.js";

/**
 * Turning the model's list of URLs into one picture.
 *
 * The model was asked for its candidates best first, and the first that
 * downloads as an actual image *and* passes the vision check wins. Two
 * things about the order are decided here rather than trusted:
 *
 * - A URL that came out of a search result is real; one the model wrote
 *   itself usually is not, and a dead one costs its whole timeout. So the
 *   known ones go first, in the model's order, and the rest go last — not
 *   dropped, because the rule is "copy from the results" and the model is
 *   told so, but a URL that turns out to exist is still a picture.
 * - Every rejection is kept with its reason, because when all of them fail
 *   the retry note has to say what was wrong with *each* — "the first spelled
 *   the title out, the second did not show it at all" — or the second attempt
 *   picks the same poster again.
 */

export interface Candidate {
  url: string;
  /** The search result it was copied from, or null for one the model wrote itself. */
  found: FoundImage | null;
}

export interface Rejection {
  url: string;
  reason: string;
  /** False when the URL did not download at all — the note for that is different. */
  downloaded: boolean;
}

export type Choice =
  | { image: DownloadedImage; verified: boolean; rejected: Rejection[] }
  | { image: null; rejected: Rejection[] };

/** Known first, in the model's order; the model's own inventions last. Exported for its own test. */
export function orderCandidates(
  urls: readonly string[],
  found: ReadonlyMap<string, FoundImage>,
): Candidate[] {
  const known: Candidate[] = [];
  const unknown: Candidate[] = [];
  for (const url of urls) {
    const hit = found.get(url) ?? null;
    (hit ? known : unknown).push({ url, found: hit });
  }
  return [...known, ...unknown];
}

export interface ChooseImageOptions {
  download(url: string, referer: string | null, signal: AbortSignal): Promise<DownloadedImage | null>;
  judge: ImageJudge;
  context: JudgeContext;
  signal: AbortSignal;
  /** Told about every candidate as it is decided, for the log. */
  report?(line: string): void;
}

export async function chooseImage(
  candidates: readonly Candidate[],
  options: ChooseImageOptions,
): Promise<Choice> {
  const rejected: Rejection[] = [];
  const report = options.report ?? (() => {});
  const total = candidates.length;

  for (const [index, candidate] of candidates.entries()) {
    if (options.signal.aborted) break;
    const position = `candidate ${index + 1}/${total}`;

    const image = await options.download(
      candidate.url,
      candidate.found?.page ?? null,
      options.signal,
    );
    if (!image) {
      rejected.push({ url: candidate.url, reason: "it did not download as an image", downloaded: false });
      report(`${position} did not download — ${candidate.url}`);
      continue;
    }

    const verdict = await options.judge.judge(image, options.context, options.signal);
    if (!verdict.accepted) {
      rejected.push({ url: candidate.url, reason: verdict.reason, downloaded: true });
      report(`${position} rejected: ${verdict.reason} — ${candidate.url}`);
      continue;
    }

    report(
      verdict.verified
        ? `${position} passed the vision check — ${candidate.url}`
        : `${position} accepted unverified (${verdict.note ?? "not checked"}) — ${candidate.url}`,
    );
    return { image, verified: verdict.verified, rejected };
  }

  return { image: null, rejected };
}
