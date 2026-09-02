import type { LanguageId, RoundContent, RoundKind, TopicId } from "@guessly/protocol";
import type { RoundRequest } from "../lobby/store.js";
import type { DownloadedImage } from "./download.js";

/** What a source hands back: what to show, and what counts as getting it right. */
export interface SourcedRound {
  content: RoundContent;
  answer: string;
  /**
   * Everything else that counts as right — and that now spans languages. The
   * lobby reads its own question and is shown its own answer, but a player who
   * types "France" at a German round has still named the thing on screen, so
   * the other languages' answers and aliases are in here too.
   */
  aliases: string[];
  /** For the server log. Never broadcast. */
  subject: string;
}

/**
 * The seam between the game and whatever finds its content. The store issues a
 * `RoundRequest` and knows nothing else, so the round bank, a fixture and a
 * stub are interchangeable here — which is what keeps a network call out of the
 * rules and out of the tests.
 */
export interface RoundContentSource {
  /** Rejects with a `RoundSourceError` if no round could be built. */
  build(request: RoundRequest, signal: AbortSignal): Promise<SourcedRound>;
}

/**
 * What a generator is asked for.
 *
 * A game's `RoundRequest` names the one language its lobby plays in; this names
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
  /** Answers that must not be produced again, in any language. */
  exclude: readonly string[];
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
 * not a URL. Whoever asked decides where the picture lives — the bank stores it
 * and serves it from this server's own origin.
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
 * The production side of the seam. `RoundContentSource` is what the *game*
 * consumes; this is what fills the bank — Claude today, anything that can
 * deliver a verified round tomorrow.
 */
export interface RoundGenerator {
  /** Rejects with a `RoundSourceError` if no round could be produced. */
  generate(request: GenerationRequest, signal: AbortSignal): Promise<GeneratedRound>;
}

/**
 * A failure with a sentence in it that is fit to put on a player's screen. The
 * underlying error goes in `cause` for the log, where it belongs; "429 from
 * api.anthropic.com" is not a thing to tell five people waiting for a picture.
 */
export class RoundSourceError extends Error {
  /**
   * The operator's half of the same failure: what is actually wrong, named
   * plainly enough to act on. Undefined when the message already says
   * everything there is to say — a round the model would not write has no
   * second explanation, but a request the API turned down does.
   */
  readonly detail: string | undefined;

  constructor(message: string, options: { cause?: unknown; detail?: string } = {}) {
    super(message, { cause: options.cause });
    this.name = "RoundSourceError";
    this.detail = options.detail;
  }
}
