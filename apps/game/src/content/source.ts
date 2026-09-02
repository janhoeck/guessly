import type { RoundContent } from "@guessly/protocol";
import type { RoundRequest } from "../lobby/store.js";

/**
 * Thrown when a round cannot be built. Defined in `@guessly/bank` — the seam
 * both processes share — and re-exported here so everything game-side keeps
 * one import path for the whole content seam.
 */
export { RoundSourceError } from "@guessly/bank";

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
 * stub are interchangeable here — which is what keeps the database out of the
 * rules and out of the tests. There is exactly one real implementation now:
 * `bank/source.ts`, reading what `tools/fill` has stocked.
 */
export interface RoundContentSource {
  /** Rejects with a `RoundSourceError` if no round could be built. */
  build(request: RoundRequest, signal: AbortSignal): Promise<SourcedRound>;
}
