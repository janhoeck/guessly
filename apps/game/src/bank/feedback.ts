import type { RoundRepository } from "@guessly/bank";
import type { RoundFeedback } from "../content/source.js";

/**
 * The bank, as the place a vote goes: the `RoundFeedback` the game talks to,
 * and — like `source.ts` for the draw — the only one.
 *
 * One insert per thumb, made *behind* the ack rather than in front of it.
 * The store has already decided the vote counts and the player has already
 * been told so; what is left is bookkeeping, and bookkeeping that fails is a
 * line in the log rather than a round that stalls on a database. The one
 * failure worth expecting is a round the admin deleted while it was on
 * screen — the foreign key refuses the row, which is the right answer, and
 * it is logged like any other.
 */
export function createBankedRoundFeedback(repository: RoundRepository): RoundFeedback {
  return {
    async record(vote) {
      try {
        await repository.recordVote(vote);
      } catch (error) {
        console.error(
          `[game] could not record a thumbs-${vote.vote} vote on round ${vote.roundId}`,
          error,
        );
      }
    },
  };
}
