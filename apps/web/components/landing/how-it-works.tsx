import * as React from "react"

import {
  DEFAULT_TARGET_SCORE,
  ROUND_DURATION_MS,
} from "@guessly/protocol"

import { cn } from "@guessly/ui/lib/utils"

/**
 * The round loop, in the order it happens.
 *
 * An <ol> rather than four cards: the steps are a real sequence, and the
 * numerals are decoration on top of that order, not the thing that creates it —
 * hence `aria-hidden` on them. The cyan rule above each item joins up across
 * the row on wide screens, so the sequence reads as one run rather than four
 * unrelated boxes.
 */

const STEPS = [
  {
    title: "Topic",
    body: "Picked at random. Flags, music, logos, games — nobody knows which.",
  },
  {
    title: "Picture or lyric",
    body: "An image, or a snippet of lyrics. Every screen gets it at the same moment.",
  },
  {
    title: `${ROUND_DURATION_MS / 1000} seconds`,
    body: "Type your guess. The round always runs the full clock, so nobody gets cut off.",
  },
  {
    title: "Points",
    body: `Right answers score, and the faster you were the more you get. First to ${DEFAULT_TARGET_SCORE} wins.`,
  },
]

function HowItWorks({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("flex flex-col gap-8", className)} {...props}>
      <h2 className="font-heading text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        How a round works
      </h2>
      <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex flex-col gap-2 border-t border-brand-cyan/25 pt-5"
          >
            <span
              aria-hidden
              className="font-heading text-sm font-semibold tracking-[0.2em] text-muted-foreground tabular-nums"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="font-heading text-base font-semibold">
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

export { HowItWorks }
