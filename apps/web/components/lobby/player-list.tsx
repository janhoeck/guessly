"use client"

import { MAX_PLAYERS_PER_LOBBY, type Player } from "@guessly/protocol"

import { Badge } from "@guessly/ui/components/ui/badge"

/**
 * Who is in the room, in join order.
 *
 * A dropped player keeps their row rather than vanishing — before the game
 * starts the server holds the seat for a minute, and a row that disappears and
 * reappears reads as somebody leaving rather than somebody's wifi blinking.
 */
function PlayerList({
  players,
  hostId,
  playerId,
}: {
  players: Player[]
  hostId: string
  playerId: string
}) {
  const connected = players.filter((player) => player.connected).length

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Players
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {connected} / {MAX_PLAYERS_PER_LOBBY}
        </span>
      </div>

      <ul className="flex flex-col">
        {players.map((player) => (
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
            <span className="ml-auto flex items-center gap-2">
              {!player.connected && (
                <span className="text-xs text-muted-foreground">Reconnecting…</span>
              )}
              {player.id === hostId && <Badge variant="outline">Host</Badge>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export { PlayerList }
