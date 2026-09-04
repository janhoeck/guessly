import type { RoundContent } from "@guessly/protocol";
import type { RoundRequest, RoundVoteRecord } from "../lobby/store.js";

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
  /**
   * The bank's own id for this round, so that what the players make of it
   * can be written down against the right row — see `RoundFeedback`. Null
   * from a source that keeps no ledger, a fixture or a stub: a vote on such
   * a round is accepted and goes nowhere.
   */
  id: number | null;
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

/**
 * The same seam, in the other direction: the game telling the bank what the
 * players thought of what it was dealt. A separate interface rather than a
 * second method on `RoundContentSource`, because a source that only finds
 * content — a fixture in a test — has no ledger to write to and should not
 * have to pretend it does. `bank/feedback.ts` is the one real implementation.
 */
export interface RoundFeedback {
  /**
   * Files one player's verdict. Resolves when it is written *or* when the
   * failure has been logged, and never rejects: the player was acked before
   * this was called, and a bank that cannot take a vote is news for the
   * log, not for the room.
   */
  record(vote: RoundVoteRecord): Promise<void>;
}
