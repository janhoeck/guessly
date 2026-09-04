"use client"

import { CrownIcon } from "lucide-react"
import type { Player, RoundState } from "@guessly/protocol"

import { Badge } from "@guessly/ui/components/ui/badge"

/**
 * The one thing a finished game owes the room: who won, and where everybody
 * else landed.
 *
 * Two headlines share this card, because two things end a game. A won game
 * names its winner over the crown; a called-off one says so plainly instead of
 * crowning whoever happened to be ahead — the standings still stand, but
 * nobody beat anybody to a target the game never reached.
 *
 * Ranks are competition-style: tied scores share a place and the next place is
 * skipped, because "joint second" is what two players on 80 points would call
 * themselves. A tie *at the top* of a won game is a draw, and the banner says
 * so rather than picking whichever seat joined first.
 */

/** "Martin", "Martin and Kim", "Martin, Kim and Ana". */
function nameThem(players: readonly Player[]): string {
  const names = players.map((player) => player.nickname)
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

function FinalStandings({
  players,
  hostId,
  playerId,
  targetScore,
  finalRound,
}: {
  players: Player[]
  hostId: string
  playerId: string
  targetScore: number
  /** The round the game ended on — still in the snapshot after a win, null
   *  after a called-off game, whose round went with it. */
  finalRound: RoundState | null
}) {
  const sorted = players
    .map((player, joinOrder) => ({ player, joinOrder }))
    .sort((a, b) => b.player.score - a.player.score || a.joinOrder - b.joinOrder)
    .map(({ player }) => player)

  const rows = sorted.map((player) => ({
    player,
    rank: sorted.findIndex((other) => other.score === player.score) + 1,
  }))

  const won = (sorted[0]?.score ?? 0) >= targetScore
  const champions = won ? rows.filter(({ rank }) => rank === 1).map(({ player }) => player) : []
  /* The bars are drawn against whichever is longer, the target or the top
     score, so the winner's bar is full and an overshoot does not spill. */
  const scale = Math.max(targetScore, sorted[0]?.score ?? 0, 1)

  return (
    <section className="flex flex-col gap-6 rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8">
      <header className="flex flex-col items-center gap-3 pt-2 text-center">
        {won ? (
          <>
            <span
              aria-hidden
              className="grid size-12 place-items-center rounded-full bg-brand-cyan text-background"
            >
              <CrownIcon className="size-6" />
            </span>
            <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase">
              {champions.length > 1 ? "It's a draw" : "Winner"}
            </p>
            <h1 className="font-heading text-4xl font-bold tracking-tight italic sm:text-5xl">
              {nameThem(champions)}
            </h1>
            <p className="text-sm text-muted-foreground">
              First to {targetScore} points
              {finalRound ? `, in ${finalRound.number} rounds` : ""}.
            </p>
          </>
        ) : (
          <>
            <p className="text-xs tracking-[0.3em] text-muted-foreground uppercase">
              Game over
            </p>
            <h1 className="font-heading text-4xl font-bold tracking-tight italic sm:text-5xl">
              Called off
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              Not enough players stayed to finish it, so the standings stand
              where the game left them.
            </p>
          </>
        )}
      </header>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Final standings
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            first to {targetScore}
          </span>
        </div>

        <ol className="flex flex-col">
          {rows.map(({ player, rank }) => {
            const champion = won && rank === 1
            return (
              <li
                key={player.id}
                className="flex items-center gap-3 border-t border-border/60 py-3 first:border-t-0"
              >
                <span
                  aria-hidden
                  className="w-6 shrink-0 text-center font-heading text-lg font-semibold text-muted-foreground tabular-nums data-[champion=true]:text-foreground"
                  data-champion={champion}
                >
                  {rank}
                </span>

                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase data-[champion=true]:bg-brand-cyan data-[champion=true]:text-background data-[dropped=true]:opacity-40"
                  data-champion={champion}
                  data-dropped={!player.connected}
                >
                  {[...player.nickname][0]}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                    {!player.connected && (
                      <span className="shrink-0 text-xs text-muted-foreground">Away</span>
                    )}
                  </span>

                  {/* How far along the race each row got, at a glance. The
                      score beside it is the accessible version; the cyan is
                      an indicator, reserved for the row that won. */}
                  <span
                    aria-hidden
                    className="h-1 w-full max-w-56 overflow-hidden rounded-full bg-secondary"
                  >
                    <span
                      className="block h-full rounded-full bg-foreground/30 data-[champion=true]:bg-brand-cyan"
                      data-champion={champion}
                      style={{ width: `${Math.min(100, (player.score / scale) * 100)}%` }}
                    />
                  </span>
                </span>

                <span className="ml-auto shrink-0 font-heading text-xl font-semibold tabular-nums">
                  {player.score}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">pts</span>
                </span>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

export { FinalStandings }
