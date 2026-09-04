"use client"

import * as React from "react"
import Link from "next/link"
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH } from "@guessly/protocol"

import { useLobbyList } from "@/components/lobbies/use-lobby-list"
import { LobbyRow } from "@/components/lobbies/lobby-row"
import { LobbyPresence } from "@/components/lobby/lobby-presence"
import { useLobby } from "@/components/lobby/use-lobby"
import { Input } from "@guessly/ui/components/ui/input"
import { Label } from "@guessly/ui/components/ui/label"

/**
 * The browse screen, and the only client island on `/lobbies`.
 *
 * It renders two subscriptions and keeps almost nothing: the list comes from
 * `useLobbyList` and the seat from `useLobby`, and both are replaced whole by
 * the server. The one piece of local state is the nickname, which has to be
 * typed somewhere and belongs to nobody until it is sent.
 *
 * A room code was a secret you read out to four friends; a browse list makes it
 * a door anybody can knock on. That is the trade this page is, and it is why
 * joining still goes through the same `lobby:join` as the code field on the
 * landing page — the rules about who may take a seat are unchanged, only how
 * you find the lobby is.
 *
 * A nickname up front rather than a prompt per row: every join needs one, and
 * asking twelve times for the same string would be worse than asking once.
 */
function LobbyBrowser() {
  const { lobbies, unreachable } = useLobbyList()
  const lobby = useLobby()
  const [nickname, setNickname] = React.useState("")
  /**
   * Which row was clicked. `pending` says a join is in flight but not into
   * what, and a whole column of buttons reading "Joining…" would be a lie
   * about eleven of them.
   */
  const [requested, setRequested] = React.useState<string | null>(null)

  const name = nickname.trim()
  const hasNickname = name.length >= NICKNAME_MIN_LENGTH
  const busy = lobby.pending !== null
  const joiningCode = lobby.pending === "join" ? requested : null

  const handleJoin = (code: string) => {
    if (!hasNickname || busy) return
    setRequested(code)
    lobby.join(code, name)
  }

  return (
    <>
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Label htmlFor="browse-nickname">Nickname</Label>
        <Input
          id="browse-nickname"
          name="nickname"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
          autoComplete="nickname"
          maxLength={NICKNAME_MAX_LENGTH}
          placeholder="What your friends call you"
          aria-describedby="browse-nickname-hint"
          className="h-11 text-base"
        />
        <p id="browse-nickname-hint" className="text-xs text-muted-foreground">
          You need one before you can join anything.
        </p>
      </div>

      <LobbyList
        lobbies={lobbies}
        unreachable={unreachable}
        canJoin={hasNickname && !busy}
        joiningCode={joiningCode}
        onJoin={handleJoin}
      />

      <LobbyPresence />
    </>
  )
}

/**
 * The list itself, and the three things it can be instead of one: still
 * looking, unreachable, or genuinely empty. They read very differently to
 * somebody waiting for a game, so none of them is allowed to render as another.
 */
function LobbyList({
  lobbies,
  unreachable,
  canJoin,
  joiningCode,
  onJoin,
}: {
  lobbies: ReturnType<typeof useLobbyList>["lobbies"]
  unreachable: boolean
  canJoin: boolean
  joiningCode: string | null
  onJoin: (code: string) => void
}) {
  if (unreachable) {
    return (
      <Notice>
        Can&rsquo;t reach the game server. This list is whatever was true when
        the connection went.
      </Notice>
    )
  }

  if (lobbies === null) {
    return <Notice>Looking for lobbies…</Notice>
  }

  if (lobbies.length === 0) {
    return (
      <Notice>
        Nobody has a lobby open right now.{" "}
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Make one
        </Link>{" "}
        and read the code out.
      </Notice>
    )
  }

  const open = lobbies.filter((lobby) => lobby.joinable).length

  return (
    <div className="flex flex-col gap-3">
      {/* Polite rather than assertive: the list moves whenever anybody
          anywhere presses a button, and a running commentary on other
          people's lobbies would drown out the page. */}
      <p aria-live="polite" className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
        {lobbies.length} {lobbies.length === 1 ? "lobby" : "lobbies"} · {open}{" "}
        you can join
      </p>

      <ul className="flex flex-col gap-3">
        {lobbies.map((lobby) => (
          <LobbyRow
            key={lobby.code}
            lobby={lobby}
            canJoin={canJoin}
            joining={joiningCode === lobby.code}
            onJoin={() => onJoin(lobby.code)}
          />
        ))}
      </ul>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-card/50 p-6 text-sm text-muted-foreground ring-1 ring-border/40">
      {children}
    </p>
  )
}

export { LobbyBrowser }
