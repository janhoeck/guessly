"use client"

import * as React from "react"
import { GUESS_MAX_LENGTH, type RoundResult } from "@guessly/protocol"

import type { GuessOutcome } from "@/components/lobby/use-lobby"
import { Button } from "@guessly/ui/components/ui/button"
import { Input } from "@guessly/ui/components/ui/input"
import { playSound } from "@/lib/sounds"
import { cn } from "@guessly/ui/lib/utils"

/**
 * The twenty seconds, from the player's side.
 *
 * Two pieces of feedback, and neither of them is a sentence you have to stop and
 * read. A wrong guess empties the field and shakes it, so "that went through"
 * and "it was not right" are the same gesture, and the field is ready for the
 * next attempt without anybody selecting and deleting under a clock. A right one
 * locks the field with the winning word still in it, because the first thing you
 * want after getting it is to see what you actually typed.
 *
 * Nothing here decides anything. Whether this player has answered is
 * `round.results`, sent by the server to the whole room; the only local state is
 * what is in the field and whether a guess is currently in the air.
 *
 * The caller keys this on the round number, so a new round arrives as a new
 * component rather than as three pieces of state to remember to clear — and
 * `autoFocus` puts the cursor back, which is the one thing a remount would
 * otherwise cost.
 */

/** Long enough to read as a "no", short enough not to delay the retype. */
const SHAKE_MS = 380

/**
 * The shake runs through the Web Animations API rather than a CSS class, and
 * that is not a stylistic preference. A class cannot restart an animation that
 * is already playing — and the guess that most needs to shake is the second
 * wrong one, typed straight over the first. `animate` starts a new one every
 * time it is called.
 */
function shake(element: HTMLElement): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

  element.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-7px)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(-4px)" },
      { transform: "translateX(2px)" },
      { transform: "translateX(0)" },
    ],
    { duration: SHAKE_MS, easing: "ease-in-out" }
  )
}

function GuessForm({
  roundNumber,
  answered,
  onGuess,
}: {
  roundNumber: number
  /** This player's result, once the server says they have one. */
  answered: RoundResult | null
  onGuess: (
    roundNumber: number,
    text: string,
    settle: (outcome: GuessOutcome) => void
  ) => void
}) {
  const [text, setText] = React.useState("")
  const [inFlight, setInFlight] = React.useState(false)
  /** The last guess that came back wrong, kept only so it can be named. */
  const [missed, setMissed] = React.useState<string | null>(null)
  const field = React.useRef<HTMLInputElement>(null)

  const locked = answered !== null
  const value = text.trim()

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!value || locked || inFlight) return

    setInFlight(true)
    onGuess(roundNumber, value, (outcome) => {
      setInFlight(false)
      // Never answered at all — the round is gone, and a verdict sound for a
      // guess that was not judged would be one of the two lies available here.
      if (!outcome) return

      // Right. The snapshot locks the field; nothing here to clear.
      if (outcome.correct) {
        playSound("correct")
        return
      }

      // The sound and the shake are the same "no", said once, to one person.
      playSound("wrong")
      setText("")
      setMissed(value)
      if (field.current) shake(field.current)
    })
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <label htmlFor="guess" className="sr-only">
        Your guess
      </label>

      <div className="flex gap-2">
        <Input
          id="guess"
          ref={field}
          name="guess"
          // The round has just opened and typing is the only thing to do on
          // this screen. Making everybody click the field first would cost
          // them the part of the clock that is worth the most points.
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={locked}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={GUESS_MAX_LENGTH}
          placeholder={locked ? "" : "Type your guess"}
          aria-describedby="guess-status"
          className={cn(
            "h-12 flex-1 text-base",
            // shadcn greys a disabled field out to say "this is not for you".
            // Here `disabled` means "you are done", which is the opposite, so
            // the fill and the text stay exactly as they were and the cyan ring
            // carries the state instead. The `!` is load-bearing: the class
            // being overridden is `dark:disabled:bg-input/80`, which is two
            // variants deep and wins on specificity otherwise.
            locked &&
              "border-brand-cyan/50 disabled:cursor-default disabled:bg-input/30! disabled:opacity-100!"
          )}
        />

        {/* There is nothing left to submit once the answer is in, so the button
            is replaced rather than disabled — a greyed-out primary reads as a
            control that has failed, not as a score. */}
        {locked ? (
          <p className="flex h-12 shrink-0 items-center gap-2 rounded-lg bg-background px-5 font-heading text-base font-semibold tabular-nums ring-1 ring-brand-cyan/50">
            <span
              aria-hidden
              className="flex size-5 items-center justify-center rounded-full bg-brand-cyan text-xs text-background"
            >
              ✓
            </span>
            +{answered.points}
          </p>
        ) : (
          <Button
            type="submit"
            size="lg"
            disabled={!value || inFlight}
            className="h-12 shrink-0 px-6 text-base"
          >
            Guess
          </Button>
        )}
      </div>

      {/* One live region for both outcomes, so a screen reader hears the same
          thing the shake says. Naming the guess that missed is what keeps it
          from repeating itself silently on a second identical attempt. */}
      <p
        id="guess-status"
        aria-live="polite"
        className={cn(
          "text-xs",
          locked
            ? "text-muted-foreground"
            : missed
              ? "text-destructive"
              : "text-muted-foreground"
        )}
      >
        {locked
          ? `Correct in ${(answered.elapsedMs / 1000).toFixed(1)}s — ${answered.points} points.`
          : missed
            ? `“${missed}” isn’t it. Keep going.`
            : "Spelling is forgiving. Speed is not."}
      </p>
    </form>
  )
}

export { GuessForm }
