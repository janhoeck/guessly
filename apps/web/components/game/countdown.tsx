"use client"

import { topicById, type RoundState } from "@guessly/protocol"

import { useServerClock } from "@/components/game/use-server-clock"

/**
 * Three, two, one.
 *
 * The countdown is not waiting for the content — it is what the wait for the
 * content is spent on. The server starts both at once, so this counts down to a
 * deadline that is already fixed, and if the round is not ready when it reaches
 * zero the screen says so plainly instead of pretending.
 */

/** How long "GO" stays up before it becomes an apology. */
const GO_LINGER_MS = 900

function Countdown({ round }: { round: RoundState }) {
  const now = useServerClock(true)
  const remaining = round.startsAt - now
  const seconds = Math.ceil(remaining / 1000)
  const topic = topicById(round.topic)

  return (
    <section className="grid flex-1 place-items-center rounded-xl bg-card p-8 ring-1 ring-foreground/10">
      <div className="flex flex-col items-center gap-8 text-center">
        <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase">
          Round {round.number} — {topic.label}
        </p>

        {remaining > 0 ? (
          <div className="relative grid size-48 place-items-center sm:size-56">
            {/* Keyed on the second so the pulse restarts with each number. */}
            <span
              key={seconds}
              aria-hidden
              className="absolute inset-0 rounded-full ring-2 ring-brand-cyan/50 motion-safe:animate-ping"
            />
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-background ring-1 ring-foreground/10"
            />
            <span
              key={`n${seconds}`}
              aria-hidden
              className="relative font-heading text-8xl font-bold tabular-nums motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200"
            >
              {seconds}
            </span>
          </div>
        ) : remaining > -GO_LINGER_MS ? (
          <span
            aria-hidden
            className="font-heading text-6xl font-bold tracking-[0.1em] uppercase italic motion-safe:animate-in motion-safe:zoom-in-50 sm:text-7xl"
          >
            Go
          </span>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span
              aria-hidden
              className="size-2 rounded-full bg-brand-cyan motion-safe:animate-pulse"
            />
            <p className="font-heading text-2xl font-semibold">Finding something good…</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The round is being put together right now. It will appear for
              everybody at the same moment.
            </p>
          </div>
        )}

        {/* One announcement, not a recital of every number. A three second
            countdown is not something a screen reader user can act on. */}
        <p className="sr-only">
          Round {round.number} is about to start. Topic: {topic.label}.
        </p>
      </div>
    </section>
  )
}

export { Countdown }
