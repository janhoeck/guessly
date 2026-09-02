import type { LanguageId, RoundKind, TopicId } from "@guessly/protocol";
import type { DownloadedImage } from "./download.js";

/** Thrown when no round could be produced. Shared with the server via the bank. */
export { RoundSourceError } from "@guessly/bank";

/**
 * What a generator is asked for.
 *
 * A game's request names the one language its lobby plays in; this names
 * *every* language the round is to be written in. One subject and one picture
 * serve all of them, so asking once and asking for everything is the difference
 * between paying for one search, one download and one cached prompt and paying
 * for as many of each as there are languages.
 */
export interface GenerationRequest {
  topic: TopicId;
  kind: RoundKind;
  number: number;
  /** Write the round in each of these. Never empty. */
  languages: readonly LanguageId[];
  /**
   * Answers that must not be produced again, in any language — folded to one
   * entry per name, so an answer two languages spell alike is listed once.
   */
  exclude: readonly string[];
  /**
   * The aliases those answers are also known by. Never shown to the model —
   * the prompt lists `exclude` and stops there — but a submission is checked
   * against them, so "United States" is refused while "USA" is on the shelf.
   * See content/dedup.ts.
   */
  excludeAliases: readonly string[];
}

/** One round as one language reads it. */
export interface GeneratedText {
  question: string;
  answer: string;
  aliases: string[];
}

/**
 * Every language a generated round was written in. Partial because the type
 * cannot know which were asked for; `parseSubmission` is what insists that the
 * ones asked for are the ones that came back.
 */
export type GeneratedTexts = Partial<Record<LanguageId, GeneratedText>>;

interface GeneratedRoundBase {
  subject: string;
  texts: GeneratedTexts;
}

/**
 * A round fresh off the production line: for an image round the actual bytes,
 * not a URL. The filler stores the picture in the bank's image store, and the
 * game server serves it from its own origin.
 */
export type GeneratedRound =
  | (GeneratedRoundBase & { kind: "image"; image: DownloadedImage })
  | (GeneratedRoundBase & {
      kind: "lyrics";
      /**
       * One paraphrase for every room, written in the *song's* language. It
       * sits out here beside the picture rather than inside `texts` for the
       * same reason the picture does: it is what the round shows, and what it
       * shows does not change with who is looking.
       */
      snippet: string;
      /** Its BCP 47 tag, or null when the source did not give a usable one. */
      snippetLanguage: string | null;
    });

/**
 * The production line's seam. `bank/` in `packages/` is what the *game*
 * consumes; this is what fills it — Claude today, anything that can deliver a
 * verified round tomorrow. The filler in `../fill.ts` drives it and the tests
 * stub it.
 */
export interface RoundGenerator {
  /** Rejects with a `RoundSourceError` if no round could be produced. */
  generate(request: GenerationRequest, signal: AbortSignal): Promise<GeneratedRound>;
}
