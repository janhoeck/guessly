"use client"

import * as React from "react"
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import { toast } from "sonner"
import type { RoundVote } from "@guessly/protocol"

import type { VoteOutcome } from "@/components/lobby/use-lobby"
import { Button } from "@guessly/ui/components/ui/button"
import { cn } from "@guessly/ui/lib/utils"

/**
 * Was that a good one?
 *
 * Two buttons and one tap, asked in the five seconds the answer is up. It is a
 * reaction rather than a setting, so the first tap is the vote: both buttons
 * lock, the chosen one stays lit, and there is no changing it. The server
 * would refuse a second thumb anyway, and a control that let you toggle for
 * five seconds would spend them on the control.
 *
 * It is about the round — the picture, the paraphrase, the question — and not
 * about whether this player got it, which is why it sits beside the answer
 * rather than beside the score. Nothing here outlives the round: the caller
 * keys this on the round number, so the next reveal is a fresh pair.
 */
function VoteButtons({
  roundNumber,
  onVote,
}: {
  roundNumber: number
  onVote: (
    roundNumber: number,
    vote: RoundVote,
    settle: (outcome: VoteOutcome) => void
  ) => void
}) {
  /** The thumb the server took. Stays null when it took one this tab never saw. */
  const [chosen, setChosen] = React.useState<RoundVote | null>(null)
  const [inFlight, setInFlight] = React.useState(false)
  const [locked, setLocked] = React.useState(false)

  const cast = (vote: RoundVote) => {
    if (locked || inFlight) return
    setInFlight(true)
    onVote(roundNumber, vote, (outcome) => {
      setInFlight(false)

      if (outcome.ok) {
        setChosen(vote)
        setLocked(true)
        return
      }

      // This seat has voted — from a tab that reloaded mid-intermission, say.
      // Locked, with neither lit: which way it went is not known here.
      if (outcome.error === "ALREADY_VOTED") {
        setLocked(true)
        return
      }

      // Too late: the next countdown opened while the thumb was in the air,
      // and these buttons are about to go with the reveal. Not worth a toast.
      if (outcome.error === "ROUND_NOT_OPEN") return

      toast.error(outcome.message)
    })
  }

  const labelId = `vote-${roundNumber}`

  return (
    <div role="group" aria-labelledby={labelId} className="flex items-center gap-2">
      <span id={labelId} aria-live="polite" className="text-xs text-muted-foreground">
        {locked ? "Noted." : "Good one?"}
      </span>
      <Thumb vote="up" chosen={chosen} disabled={locked || inFlight} onCast={cast} />
      <Thumb vote="down" chosen={chosen} disabled={locked || inFlight} onCast={cast} />
    </div>
  )
}

function Thumb({
  vote,
  chosen,
  disabled,
  onCast,
}: {
  vote: RoundVote
  chosen: RoundVote | null
  disabled: boolean
  onCast: (vote: RoundVote) => void
}) {
  const lit = chosen === vote
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-pressed={lit}
      aria-label={vote === "up" ? "Thumbs up" : "Thumbs down"}
      disabled={disabled}
      onClick={() => onCast(vote)}
      className={cn(
        // shadcn fades a disabled button to say "not for you". The one that
        // was chosen is disabled because it *was* for you, so it keeps its
        // full weight and takes the cyan ring the locked guess field wears —
        // the same "you are done" in the same colour.
        lit && "border-brand-cyan/50 ring-1 ring-brand-cyan/50 disabled:opacity-100"
      )}
    >
      {vote === "up" ? <ThumbsUpIcon /> : <ThumbsDownIcon />}
    </Button>
  )
}

export { VoteButtons }
