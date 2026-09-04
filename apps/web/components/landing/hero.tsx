import {
  MAX_PLAYERS_PER_LOBBY,
  ROUND_DURATION_MS,
} from "@guessly/protocol"

import { Wordmark } from "@guessly/ui/components/wordmark"

/**
 * The page's thesis, in three lines: what this is, who it is for, and the one
 * rule that makes it a game rather than a quiz.
 *
 * The numbers come from the protocol package rather than the copy deck, so the
 * pitch cannot drift away from what the server actually does.
 */
function Hero() {
  return (
    <div className="flex flex-col items-start gap-6">
      {/* Three items rather than one string: tracked-out caps are wide, and on
          a narrow screen this has to break between the two phrases rather than
          leaving "players" stranded on its own line. */}
      <p className="flex flex-wrap gap-x-2 text-xs tracking-[0.2em] text-muted-foreground uppercase sm:tracking-[0.28em]">
        <span>Realtime party game</span>
        <span aria-hidden>·</span>
        <span>up to {MAX_PLAYERS_PER_LOBBY} players</span>
      </p>
      <h1>
        <Wordmark className="text-6xl leading-[0.9] sm:text-7xl" />
      </h1>
      <p className="max-w-[38ch] text-lg leading-relaxed text-muted-foreground sm:text-xl">
        Everyone sees the same thing at the same moment. You get{" "}
        <strong className="font-semibold text-foreground">
          {ROUND_DURATION_MS / 1000} seconds
        </strong>{" "}
        to work out what it is, and the faster you are right, the more you
        score.
      </p>
    </div>
  )
}

export { Hero }
