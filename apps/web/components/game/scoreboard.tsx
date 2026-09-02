"use client"

import type { Player, RoundState } from "@guessly/protocol"

import { Badge } from "@/components/ui/badge"

/**
 * Who is playing, where they are, and — while a round is running — who is
 * already done.
 *
 * A player's round shows up here the instant the server scores it, not at the
 * reveal. Watching a row settle at 1.4 seconds while you are still typing is the
 * pressure the round is made of, and it gives nothing away: knowing that Kim
 * knows the answer is not knowing the answer.
 *
 * Rows are ordered by score and then by how long they have been in the room, so
 * a scoreboard of zeroes reads as join order rather than shuffling itself every
 * render. A dropped player keeps their row and their score — once a game is
 * running the server holds the seat until the end, and a row that vanished would
 * say somebody left when all that happened was a phone going to sleep.
 */
function Scoreboard({
  players,
  hostId,
  playerId,
  targetScore,
  round,
}: {
  players: Player[]
  hostId: string
  playerId: string
  targetScore: number
  /** Null while the lobby is being set up rather than played. */
  round: RoundState | null
}) {
  const ranked = players
    .map((player, joinOrder) => ({ player, joinOrder }))
    .sort((a, b) => b.player.score - a.player.score || a.joinOrder - b.joinOrder)

  const results = new Map(round?.results.map((result) => [result.playerId, result]))
  const revealed = round?.answer !== null && round?.answer !== undefined
  /** Guessing is open: there is content on screen and no answer under it yet. */
  const guessing = round?.content != null && !revealed

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Scores
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          first to {targetScore}
        </span>
      </div>

      <ol className="flex flex-col">
        {ranked.map(({ player }) => {
          const result = results.get(player.id)
          const done = result !== undefined

          return (
            <li
              key={player.id}
              className="flex items-center gap-3 border-t border-border/60 py-2 first:border-t-0"
            >
              {/* The initial becomes a tick the moment the round is won, so the
                  row can be read at a glance without reading the numbers. */}
              <span
                aria-hidden
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase data-[done=true]:bg-brand-cyan data-[done=true]:text-background data-[dropped=true]:opacity-40"
                data-dropped={!player.connected}
                data-done={done}
              >
                {done ? "✓" : [...player.nickname][0]}
              </span>

              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    className="min-w-0 truncate font-medium data-[dropped=true]:text-muted-foreground"
                    data-dropped={!player.connected}
                  >
                    {player.nickname}
                  </span>
                  {player.id === playerId && (
                    <span className="shrink-0 text-xs text-muted-foreground">(you)</span>
                  )}
                  {player.id === hostId && (
                    <Badge variant="outline" className="shrink-0">
                      Host
                    </Badge>
                  )}
                </span>

                <RoundStatus
                  result={result}
                  connected={player.connected}
                  revealed={revealed}
                  guessing={guessing}
                />
              </span>

              <span className="ml-auto font-heading font-semibold tabular-nums">
                {player.score}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * A player's standing in the round in progress, in one line under their name.
 *
 * The order of the branches is the order of what matters: a result outranks
 * everything, because a player who has already scored has done so whether or not
 * their phone has since gone to sleep.
 */
function RoundStatus({
  result,
  connected,
  revealed,
  guessing,
}: {
  result: { elapsedMs: number; points: number } | undefined
  connected: boolean
  revealed: boolean
  guessing: boolean
}) {
  if (result) {
    return (
      // The cyan is carried by the tick beside this line, never by the words:
      // it is an indicator token and it is not readable as text on a card.
      <span className="text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">Done</span> ·{" "}
        {(result.elapsedMs / 1000).toFixed(1)}s · +{result.points}
      </span>
    )
  }
  if (!connected) return <span className="text-xs text-muted-foreground">Away</span>
  if (revealed) return <span className="text-xs text-muted-foreground">No answer</span>
  if (guessing) return <span className="text-xs text-muted-foreground">Guessing…</span>
  return null
}

export { Scoreboard }
