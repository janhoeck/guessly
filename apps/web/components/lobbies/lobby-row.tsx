"use client"

import {
  MAX_PLAYERS_PER_LOBBY,
  isPlaying,
  languageById,
  type LobbySummary,
} from "@guessly/protocol"

import { Button } from "@guessly/ui/components/ui/button"
import { cn } from "@guessly/ui/lib/utils"

/**
 * One lobby, as somebody outside it sees it: the code, how full it is, what
 * language it plays in, and whether there is a way in.
 *
 * Nothing here decides whether the row may be joined — `joinable` is the
 * server's own answer, and re-deriving it from the status and the seat count
 * would be a second copy of a rule `lobby:join` is about to apply anyway. What
 * this component does decide is how to *say* it.
 */

/** What the badge reads, and how loudly the row carries itself. */
type Standing = {
  label: string
  tone: "open" | "running" | "closed"
}

function standingOf(lobby: LobbySummary): Standing {
  if (isPlaying(lobby.status)) return { label: "In game", tone: "running" }
  // A finished lobby is a room between games. The host may well press Play
  // again in a moment, but only for the seats already in it.
  if (lobby.status === "finished") return { label: "Between games", tone: "closed" }
  // Open, then, and the only thing left that can shut the door is the cap.
  return lobby.joinable
    ? { label: "Open", tone: "open" }
    : { label: "Full", tone: "closed" }
}

/**
 * The one thing on the row that is not text: a dot in a brand colour, which is
 * what those colours are for. Cyan for a room you can walk into, pink for one
 * that is mid-round — never the yellow, which belongs to the button.
 */
function StandingBadge({ standing }: { standing: Standing }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-4xl px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        standing.tone === "closed"
          ? "bg-muted/60 text-muted-foreground"
          : "bg-muted text-foreground"
      )}
    >
      {standing.tone !== "closed" && (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            standing.tone === "running"
              ? "animate-pulse bg-brand-pink"
              : "bg-brand-cyan"
          )}
        />
      )}
      {standing.label}
    </span>
  )
}

function LobbyRow({
  lobby,
  canJoin,
  joining,
  onJoin,
}: {
  lobby: LobbySummary
  /** Everything else that has to be true before Join does anything — a nickname. */
  canJoin: boolean
  joining: boolean
  onJoin: () => void
}) {
  const standing = standingOf(lobby)
  const language = languageById(lobby.language)
  /**
   * Would a click do anything? It is what decides the yellow: a row you can
   * walk into is the call to action on its own line, and the rows you cannot
   * step back into the card. It stays yellow through `joining`, because the
   * button is then reporting on a click that was allowed.
   */
  const clickable = lobby.joinable && canJoin

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl p-4 ring-1 transition-colors",
        standing.tone === "open" && "bg-card ring-border/60",
        // Still on the list, and visibly not on offer. The pink rule is the
        // loudest thing about it, which is the point: a game in progress is
        // the interesting kind of unavailable.
        standing.tone === "running" && "bg-card/50 ring-brand-pink/30",
        standing.tone === "closed" && "bg-card/50 ring-border/40"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <strong
            /* The tracking pushes the run right; the negative indent puts the
               five characters back on the optical centre of their own box. */
            className="font-heading text-xl font-bold tracking-[0.25em] [text-indent:0.25em] uppercase tabular-nums"
            aria-label={`Room ${lobby.code.split("").join(" ")}`}
          >
            {lobby.code}
          </strong>
          <StandingBadge standing={standing} />
        </div>

        <p className="text-sm text-muted-foreground">
          {lobby.players} of {MAX_PLAYERS_PER_LOBBY} players
          <span aria-hidden> · </span>
          {language.label}
        </p>
      </div>

      <Button
        type="button"
        variant={clickable ? "default" : "secondary"}
        size="lg"
        disabled={!clickable || joining}
        onClick={onJoin}
        /* Twelve buttons all called "Join" is a list nobody can navigate by
           ear. The code is spelled out here for the same reason it is above. */
        aria-label={`Join room ${lobby.code.split("").join(" ")}`}
        className="h-10 px-5"
      >
        {joining ? "Joining…" : "Join"}
      </Button>
    </li>
  )
}

export { LobbyRow }
