"use client"

import type { Player } from "@guessly/protocol"

import { Badge } from "@/components/ui/badge"

/**
 * Who is playing and where they are, ordered by score and then by how long they
 * have been in the room — so a scoreboard of zeroes reads as join order rather
 * than shuffling itself every render.
 *
 * A dropped player keeps their row and their score. Once a game is running the
 * server holds the seat until the end, and a row that vanished would say
 * somebody left when all that happened was a phone going to sleep.
 */
function Scoreboard({
  players,
  hostId,
  playerId,
  targetScore,
}: {
  players: Player[]
  hostId: string
  playerId: string
  targetScore: number
}) {
  const ranked = players
    .map((player, joinOrder) => ({ player, joinOrder }))
    .sort((a, b) => b.player.score - a.player.score || a.joinOrder - b.joinOrder)

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
        {ranked.map(({ player }) => (
          <li
            key={player.id}
            className="flex items-center gap-3 border-t border-border/60 py-2 first:border-t-0"
          >
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium uppercase data-[dropped=true]:opacity-40"
              data-dropped={!player.connected}
            >
              {[...player.nickname][0]}
            </span>
            <span
              className="min-w-0 truncate font-medium data-[dropped=true]:text-muted-foreground"
              data-dropped={!player.connected}
            >
              {player.nickname}
            </span>
            {player.id === playerId && (
              <span className="text-xs text-muted-foreground">(you)</span>
            )}
            {player.id === hostId && (
              <Badge variant="outline" className="shrink-0">
                Host
              </Badge>
            )}
            <span className="ml-auto flex items-center gap-2">
              {!player.connected && (
                <span className="text-xs text-muted-foreground">Away</span>
              )}
              <span className="font-heading font-semibold tabular-nums">
                {player.score}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export { Scoreboard }
