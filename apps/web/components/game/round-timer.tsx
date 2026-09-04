"use client"

import * as React from "react"

import { useServerClock } from "@/components/game/use-server-clock"
import { playSound } from "@/lib/sounds"
import { cn } from "@guessly/ui/lib/utils"

/**
 * The twenty seconds, drawn — and, at the end, heard.
 *
 * Both ends come from the server, so every player's bar empties at the same
 * moment regardless of when their browser rendered it. The bar turns pink for
 * the last few seconds — an indicator, which is what the brand accents are
 * for, and the one place on this screen that has to be noticed without being
 * read.
 *
 * The last three seconds also tick, with the same glass ding the round opened
 * on. That is deliberately the same sound rather than a fifth one: it is the
 * same event either side of the round — a number changing next to zero — and
 * four sounds from one pack is the whole of this game's voice.
 */

/** When the bar stops being information and starts being pressure. */
const URGENT_MS = 5_000

/** How many of the closing seconds get a tick, one each: three, two, one. */
const TICKING_SECONDS = 3

function RoundTimer({
  startsAt,
  endsAt,
  silent = false,
  className,
}: {
  startsAt: number
  endsAt: number
  /** Set for a player who has already answered. The clock only runs on past a
   *  correct guess because somebody else is still typing, and that person's
   *  last three seconds are not this one's to be hurried by — see the locked
   *  field beside it, which says the same thing without a sound. */
  silent?: boolean
  className?: string
}) {
  const now = useServerClock(true)

  const total = Math.max(1, endsAt - startsAt)
  const left = Math.min(total, Math.max(0, endsAt - now))
  const urgent = left <= URGENT_MS
  const seconds = Math.ceil(left / 1000)

  /**
   * Keyed on the displayed second rather than on a timer of its own, so the
   * tick and the digit are one event and cannot drift apart. It also means a
   * tab that spent the round in the background comes back to whatever the
   * clock actually says instead of replaying a queue of missed ticks, which is
   * the same reason `useServerClock` runs on frames.
   *
   * A tab that arrives mid-tick — a reload with two seconds left — ticks for
   * the second it landed in, because that is the truth of the clock and the
   * silence would read as a broken one.
   */
  const lastSecond = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (lastSecond.current === seconds) return
    lastSecond.current = seconds
    if (!silent && seconds >= 1 && seconds <= TICKING_SECONDS) playSound("tick")
  }, [seconds, silent])

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div
        role="progressbar"
        aria-label="Time left in this round"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={seconds}
        aria-valuetext={`${seconds} seconds left`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"
      >
        <span
          className={cn(
            "block h-full rounded-full",
            urgent ? "bg-brand-pink" : "bg-brand-cyan"
          )}
          style={{ width: `${(left / total) * 100}%` }}
        />
      </div>
      <span
        aria-hidden
        className={cn(
          "font-heading text-2xl font-bold tabular-nums",
          urgent && "text-brand-pink"
        )}
      >
        {(left / 1000).toFixed(1)}
        <span className="text-base text-muted-foreground">s</span>
      </span>
    </div>
  )
}

export { RoundTimer }
