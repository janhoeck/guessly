import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import type { RoundVoteTally } from "@guessly/bank"

import { cn } from "@guessly/ui/lib/utils"

/**
 * How a round was received, at a glance: the two thumbs the reveal offers,
 * each with its count. A round nobody has judged is a dash rather than two
 * zeros, the way a language a round was not written in is — the list is
 * scanned for the rounds with something to say about them, and 0 · 0 on
 * every row would bury the one that reads 0 · 7. A thumb nobody has given
 * is dimmed for the same reason. A screen reader gets the sentence instead.
 */
function VoteTally({ votes, className }: { votes: RoundVoteTally; className?: string }) {
  if (votes.up === 0 && votes.down === 0) {
    return (
      <span aria-label="Not rated yet" className={cn("text-muted-foreground/50", className)}>
        —
      </span>
    )
  }

  return (
    <span className={cn("inline-flex items-center gap-3 tabular-nums", className)}>
      <span className="sr-only">{describeVotes(votes)}</span>
      <Thumb count={votes.up}>
        <ThumbsUpIcon className="size-3.5" />
      </Thumb>
      <Thumb count={votes.down}>
        <ThumbsDownIcon className="size-3.5" />
      </Thumb>
    </span>
  )
}

function Thumb({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className={cn("inline-flex items-center gap-1", count === 0 && "text-muted-foreground/50")}
    >
      {children}
      {count}
    </span>
  )
}

const times = (n: number): string => `${n} ${n === 1 ? "time" : "times"}`

/**
 * The tally as a sentence — "Liked 4 times, never disliked." — for a screen
 * reader here and for the round page's ledger line, so the two agree.
 */
function describeVotes({ up, down }: RoundVoteTally): string {
  if (up === 0 && down === 0) return "Not rated yet."
  const liked = up === 0 ? "Never liked" : `Liked ${times(up)}`
  const disliked = down === 0 ? "never disliked" : `disliked ${times(down)}`
  return `${liked}, ${disliked}.`
}

export { VoteTally, describeVotes }
