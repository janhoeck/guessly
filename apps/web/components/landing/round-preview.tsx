import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A round, frozen mid-clock. Twelve seconds left, two players already in, one
 * still typing.
 *
 * It is a picture of the game, not the game: `aria-hidden` because the same
 * information is carried in words by HowItWorks, and a screen reader has no use
 * for a fake scoreboard. That is also why it is built from plain elements
 * rather than Avatar and Progress — nothing here needs the behaviour those
 * primitives ship, and the panel stays entirely server-rendered.
 */

const GUESSES = [
  { initials: "ER", name: "Erik", detail: "1.9s", points: "+18" },
  { initials: "JA", name: "Jan", detail: "4.4s", points: "+12" },
  { initials: "SA", name: "Sam", detail: "still typing", points: "—" },
]

function RoundPreview({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex w-full max-w-md flex-col gap-5 rounded-xl bg-card p-6 ring-1 ring-foreground/10",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-heading text-sm font-semibold tracking-wide uppercase">
          <span className="size-1.5 rounded-full bg-brand-cyan motion-safe:animate-pulse" />
          Round 3
        </span>
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Flags
        </span>
      </div>

      {/* The content plate: a picture sitting in a viewer, so the panel shows
          the shape of a round without shipping an asset. The flag is invented —
          three bands of the brand accents — and it stays small, because the
          loudest thing on this page is the call to action, not the artwork. */}
      <div className="grid aspect-[16/9] place-items-center rounded-lg bg-background ring-1 ring-foreground/10">
        <span className="grid aspect-[3/2] w-1/2 grid-cols-3 overflow-hidden rounded-md ring-1 ring-foreground/15">
          <span className="bg-brand-cyan" />
          <span className="bg-foreground" />
          <span className="bg-brand-pink" />
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <span className="block h-full w-[62%] rounded-full bg-brand-cyan" />
        </div>
        <span className="font-heading text-2xl font-bold tabular-nums">
          12.4
          <span className="text-base text-muted-foreground">s</span>
        </span>
      </div>

      <ul className="flex flex-col">
        {GUESSES.map((guess) => (
          <li
            key={guess.name}
            className="flex items-center gap-3 border-t border-border/60 py-3 last:pb-0"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
              {guess.initials}
            </span>
            <span className="font-medium">{guess.name}</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {guess.detail}
            </span>
            <span className="w-10 text-right font-heading font-semibold tabular-nums">
              {guess.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export { RoundPreview }
