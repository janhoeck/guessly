import type { RoundContent, RoundKind, TopicId } from "@guessly/protocol";
import type { RoundRequest } from "../lobby/store.js";
import type { DownloadedImage } from "./download.js";

/** What a source hands back: what to show, and what counts as getting it right. */
export interface SourcedRound {
  content: RoundContent;
  answer: string;
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
 * What a generator is asked for. A game's `RoundRequest` satisfies it as-is;
 * the bank's background refill builds one of these without pretending to have
 * a lobby code or a countdown.
 */
export interface GenerationRequest {
  topic: TopicId;
  kind: RoundKind;
  number: number;
  /** Answers that must not be produced again. */
  exclude: readonly string[];
}

interface GeneratedRoundBase {
  question: string;
  answer: string;
  aliases: string[];
  subject: string;
}

/**
 * A round fresh off the production line: for an image round the actual bytes,
 * not a URL. Whoever asked decides where the picture lives — the bank stores it
 * and serves it from this server's own origin.
 */
export type GeneratedRound =
  | (GeneratedRoundBase & { kind: "image"; image: DownloadedImage })
  | (GeneratedRoundBase & { kind: "lyrics"; snippet: string });

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
