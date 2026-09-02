"use client"

import { topicById, type Player, type RoundState } from "@guessly/protocol"

import { GuessForm } from "@/components/game/guess-form"
import { RoundImage } from "@/components/game/round-image"
import { RoundTimer } from "@/components/game/round-timer"
import { useServerClock } from "@/components/game/use-server-clock"
import type { GuessOutcome } from "@/components/lobby/use-lobby"

/**
 * The round itself: the question, the thing to look at, the clock, and the field
 * you type into.
 *
 * Everything here comes from one `RoundState` and nothing is remembered between
 * renders — including whether the answer is known, which is not a flag this
 * component keeps but a field the server fills in at the reveal and leaves null
 * until then, and including whether this player has already got it, which is a
 * row in `results` that the whole room can see.
 */
function RoundStage({
  round,
  players,
  playerId,
  targetScore,
  onGuess,
}: {
  round: RoundState
  players: Player[]
  playerId: string
  targetScore: number
  onGuess: (
    roundNumber: number,
    text: string,
    settle: (outcome: GuessOutcome) => void
  ) => void
}) {
  const topic = topicById(round.topic)
  const { content } = round
  const revealed = round.answer !== null
  const mine = round.results.find((result) => result.playerId === playerId) ?? null

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
      <div className="grid max-h-[45vh] min-h-56 flex-1 place-items-center overflow-hidden rounded-lg bg-background p-4 ring-1 ring-foreground/10">
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
        <>
          <RoundTimer startsAt={round.startsAt} endsAt={round.endsAt} />
          {/* Keyed on the round: a new round is a new field rather than three
              pieces of state somebody has to remember to clear. */}
          <GuessForm
            key={round.number}
            roundNumber={round.number}
            answered={mine}
            onGuess={onGuess}
          />
        </>
      )}

      {revealed && (
        <Reveal
          answer={round.answer ?? ""}
          scored={round.results.length}
          players={players}
          targetScore={targetScore}
          opensAt={round.intermissionEndsAt}
        />
      )}
    </section>
  )
}

/**
 * The answer, and what happens next.
 *
 * The gap between rounds is a real deadline the server stamped, so it is counted
 * down rather than waited out: five seconds of a screen that says nothing reads
 * exactly like five seconds of a screen that has broken.
 */
function Reveal({
  answer,
  scored,
  players,
  targetScore,
  opensAt,
}: {
  answer: string
  scored: number
  players: Player[]
  targetScore: number
  opensAt: number | null
}) {
  const won = players.some((player) => player.score >= targetScore)
  const now = useServerClock(opensAt !== null && !won)
  const seconds = opensAt === null ? 0 : Math.max(0, Math.ceil((opensAt - now) / 1000))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-background p-4 ring-1 ring-brand-cyan/25">
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          The answer
        </span>
        <strong className="font-heading text-2xl font-bold">{answer}</strong>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {scored === 0
          ? "Nobody got that one."
          : `${scored} of ${players.length} got it.`}{" "}
        {won
          ? "That is the game."
          : seconds > 0
            ? `Next round in ${seconds}…`
            : "Next round coming up…"}
      </p>
    </div>
  )
}

export { RoundStage }
