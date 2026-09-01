"use client"

import { topicById, type RoundState } from "@guessly/protocol"

import { RoundImage } from "@/components/game/round-image"
import { RoundTimer } from "@/components/game/round-timer"

/**
 * The round itself: the question, the thing to look at, and the clock.
 *
 * Everything here comes from one `RoundState` and nothing is remembered between
 * renders — including whether the answer is known, which is not a flag this
 * component keeps but a field the server fills in at the reveal and leaves null
 * until then.
 */
function RoundStage({ round }: { round: RoundState }) {
  const topic = topicById(round.topic)
  const { content } = round
  const revealed = round.answer !== null

  return (
    <section className="flex flex-1 flex-col gap-5 rounded-xl bg-card p-6 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-2 font-heading text-sm font-semibold tracking-wide uppercase">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-brand-cyan motion-safe:animate-pulse"
          />
          Round {round.number}
        </span>
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {topic.label}
        </span>
      </div>

      {content && (
        <h1 className="font-heading text-2xl font-semibold text-balance sm:text-3xl">
          {content.question}
        </h1>
      )}

      {/* Capped rather than left to the picture's own size: everyone is looking
          at the same thing at the same time, and a portrait photograph that
          pushes the clock below the fold is a round some players cannot see. */}
      <div className="grid max-h-[55vh] min-h-64 flex-1 place-items-center overflow-hidden rounded-lg bg-background p-4 ring-1 ring-foreground/10">
        {content?.kind === "image" && (
          <RoundImage key={content.imageUrl} url={content.imageUrl} />
        )}
        {content?.kind === "lyrics" && (
          <blockquote className="max-w-xl px-2 text-center">
            <p className="font-heading text-xl leading-relaxed whitespace-pre-line text-balance sm:text-2xl">
              {content.snippet}
            </p>
            {/* Said out loud rather than quietly assumed: these are not the
                real words, and a player who knows the song should know why it
                does not scan. */}
            <footer className="mt-5 text-xs tracking-[0.2em] text-muted-foreground uppercase">
              Lyrics, paraphrased
            </footer>
          </blockquote>
        )}
      </div>

      {!revealed && round.endsAt !== null && (
        <RoundTimer startsAt={round.startsAt} endsAt={round.endsAt} />
      )}

      {revealed && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-background p-4 ring-1 ring-brand-cyan/25">
            <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
              The answer
            </span>
            <strong className="font-heading text-2xl font-bold">{round.answer}</strong>
          </div>
          {/* Where round two plugs in. Until guessing and scoring exist there is
              nothing to advance to, and saying so is better than a screen that
              looks like it is still loading. */}
          <p className="text-xs text-muted-foreground">
            Guessing and scoring are not wired up yet, so the game stops here.
          </p>
        </div>
      )}
    </section>
  )
}

export { RoundStage }
