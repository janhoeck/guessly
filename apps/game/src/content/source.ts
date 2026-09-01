import type { RoundContent } from "@guessly/protocol";
import type { RoundRequest } from "../lobby/store.js";

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
 * `RoundRequest` and knows nothing else, so a live model, a fixture and a stub
 * are interchangeable here — which is what keeps a network call out of the
 * rules and out of the tests.
 */
export interface RoundContentSource {
  /** Rejects with a `RoundSourceError` if no round could be built. */
  build(request: RoundRequest, signal: AbortSignal): Promise<SourcedRound>;
}

/**
 * A failure with a sentence in it that is fit to put on a player's screen. The
 * underlying error goes in `cause` for the log, where it belongs; "429 from
 * api.anthropic.com" is not a thing to tell five people waiting for a picture.
 */
export class RoundSourceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "RoundSourceError";
  }
}
