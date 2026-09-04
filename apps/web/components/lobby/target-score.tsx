"use client"

import { MinusIcon, PlusIcon } from "lucide-react"
import { MAX_TARGET_SCORE, MIN_TARGET_SCORE } from "@guessly/protocol"

import { Button } from "@guessly/ui/components/ui/button"

/**
 * How many points win the game.
 *
 * A stepper rather than a text field: the value is server-authoritative, and a
 * bound input would have to fight the snapshot arriving mid-keystroke. Buttons
 * emit one whole valid value at a time, so there is never a half-typed "5" to
 * reconcile.
 */

/** Coarse enough that crossing the range is a few clicks, fine enough to matter. */
const STEP = 25

function TargetScore({
  targetScore,
  onChange,
  disabled = false,
}: {
  targetScore: number
  onChange: (targetScore: number) => void
  disabled?: boolean
}) {
  const step = (delta: number) => {
    const next = Math.min(MAX_TARGET_SCORE, Math.max(MIN_TARGET_SCORE, targetScore + delta))
    if (next !== targetScore) onChange(next)
  }

  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Target score
      </span>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          disabled={disabled || targetScore <= MIN_TARGET_SCORE}
          onClick={() => step(-STEP)}
          aria-label={`Lower the target score by ${STEP}`}
        >
          <MinusIcon />
        </Button>

        {/* aria-live so a screen reader hears the new total rather than only
            the button that changed it. */}
        <output
          aria-live="polite"
          className="flex h-9 flex-1 items-center justify-center rounded-lg bg-background font-heading text-xl font-bold ring-1 ring-border tabular-nums"
        >
          {targetScore}
        </output>

        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          disabled={disabled || targetScore >= MAX_TARGET_SCORE}
          onClick={() => step(STEP)}
          aria-label={`Raise the target score by ${STEP}`}
        >
          <PlusIcon />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        First to {targetScore} points wins. {MIN_TARGET_SCORE}–{MAX_TARGET_SCORE}.
      </p>
    </section>
  )
}

/** The same figure for everyone who cannot change it. */
function TargetScoreSummary({ targetScore }: { targetScore: number }) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        Target score
      </span>
      <p className="text-sm">
        First to{" "}
        <strong className="font-heading font-bold tabular-nums">{targetScore}</strong>{" "}
        points wins.
      </p>
    </section>
  )
}

export { TargetScore, TargetScoreSummary }
