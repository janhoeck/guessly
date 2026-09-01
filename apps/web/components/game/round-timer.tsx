"use client"

import { useServerClock } from "@/components/game/use-server-clock"
import { cn } from "@/lib/utils"

/**
 * The twenty seconds, drawn.
 *
 * Both ends come from the server, so every player's bar empties at the same
 * moment regardless of when their browser rendered it. The bar turns pink for
 * the last few seconds — an indicator, which is what the brand accents are
 * for, and the one place on this screen that has to be noticed without being
 * read.
 */

/** When the bar stops being information and starts being pressure. */
const URGENT_MS = 5_000

function RoundTimer({
  startsAt,
  endsAt,
  className,
}: {
  startsAt: number
  endsAt: number
  className?: string
}) {
  const now = useServerClock(true)

  const total = Math.max(1, endsAt - startsAt)
  const left = Math.min(total, Math.max(0, endsAt - now))
  const urgent = left <= URGENT_MS

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div
        role="progressbar"
        aria-label="Time left in this round"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.ceil(left / 1000)}
        aria-valuetext={`${Math.ceil(left / 1000)} seconds left`}
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
