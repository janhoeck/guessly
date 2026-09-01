"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ALL_TOPIC_IDS,
  DEFAULT_TARGET_SCORE,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROOM_CODE_LENGTH,
} from "@guessly/protocol"

import { LobbyDialog } from "@/components/lobby/lobby-dialog"
import { useLobby } from "@/components/lobby/use-lobby"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

/**
 * Nickname, then the two ways in: make a lobby, or join one with its code.
 *
 * **This file is the landing page's client island.** Everything around it — the
 * card, the hero, the round preview, the step list — is server-rendered and
 * stays that way. The connection itself lives one level down in
 * `useLobby`, which is the only thing in the client that talks to the game
 * server; this component supplies the two inputs that start it and renders the
 * lobby the answer opens.
 *
 * One <form> rather than two, because both paths need the same nickname and
 * asking for it twice would be worse than sharing it. The two submit buttons
 * carry their intent in `name="intent"`, and the submitter is what tells create
 * from join.
 *
 * A lobby cannot be made anonymously — there is no seat without a name — so
 * both buttons stay disabled until there is one to send.
 *
 * It also owns one navigation: the moment the lobby stops being a lobby,
 * everybody in it — host and guests alike — is moved to `/<CODE>`, because a
 * game is a place you are at rather than a dialog over the page that sold it to
 * you. The connection itself does not notice the move; it lives outside the
 * component tree for exactly this reason.
 */
function EntryForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [nickname, setNickname] = React.useState("")
  // Seeded from `?code=`, which is how somebody arrives after following a link
  // to a game they have no seat in. They still have to give a nickname, so this
  // is a shortcut and not a redirect.
  const [code, setCode] = React.useState(() =>
    (searchParams.get("code") ?? "").toUpperCase().slice(0, ROOM_CODE_LENGTH)
  )
  const lobby = useLobby()

  const startedCode =
    lobby.state && lobby.state.status !== "lobby" ? lobby.state.code : null

  // `replace` rather than `push`: the landing page would immediately send a
  // player who pressed Back straight forward again, which is a trap rather
  // than a history entry.
  React.useEffect(() => {
    if (startedCode) router.replace(`/${startedCode}`)
  }, [startedCode, router])

  const name = nickname.trim()
  const hasNickname = name.length >= NICKNAME_MIN_LENGTH
  const hasCode = code.length === ROOM_CODE_LENGTH
  const busy = lobby.pending !== null

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!hasNickname || busy) return

    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (submitter?.getAttribute("value") === "join") {
      if (hasCode) lobby.join(code, name)
      return
    }
    // A new lobby opens on the defaults — every topic, the default target —
    // and is configured in the dialog that opens with it, where the host can
    // see the code they are about to read out at the same time.
    lobby.create(name, DEFAULT_TARGET_SCORE, [...ALL_TOPIC_IDS])
  }

  return (
    <>
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="nickname">Nickname</Label>
          <Input
            id="nickname"
            name="nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            autoComplete="nickname"
            maxLength={NICKNAME_MAX_LENGTH}
            placeholder="What your friends call you"
            aria-describedby="nickname-hint"
            className="h-11 text-base"
          />
          <p id="nickname-hint" className="text-xs text-muted-foreground">
            Up to {NICKNAME_MAX_LENGTH} characters. You need one either way.
          </p>
        </div>

        <Button
          type="submit"
          name="intent"
          value="create"
          size="lg"
          disabled={!hasNickname || busy}
          className="h-11 w-full text-base"
        >
          {lobby.pending === "create" ? "Creating lobby…" : "Create lobby"}
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            or
          </span>
          <Separator className="flex-1" />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Room code</Label>
          <div className="flex gap-2">
            <Input
              id="code"
              name="code"
              value={code}
              /* Uppercased on the way in, not on the way out: the server
                 normalises too, but a field that shows what it will send is
                 one fewer thing to wonder about. */
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="K7QMX"
              aria-describedby="code-hint"
              /* Tracked out and centred like a code being read off a screen. The
                 text-indent cancels the trailing letter-space so the five
                 characters sit optically centred rather than pushed left. */
              className="h-11 flex-1 text-center font-heading text-lg font-semibold tracking-[0.35em] [text-indent:0.35em] uppercase"
            />
            <Button
              type="submit"
              name="intent"
              value="join"
              variant="secondary"
              size="lg"
              disabled={!hasNickname || !hasCode || busy}
              className="h-11 shrink-0 px-5 text-base"
            >
              {lobby.pending === "join" ? "Joining…" : "Join"}
            </Button>
          </div>
          <p id="code-hint" className="text-xs text-muted-foreground">
            {ROOM_CODE_LENGTH} characters. No I, L, O, 0 or 1 — codes get read out
            loud.
          </p>
        </div>
      </form>

      {lobby.state && lobby.playerId && lobby.state.status === "lobby" && (
        <LobbyDialog
          state={lobby.state}
          playerId={lobby.playerId}
          starting={lobby.pending === "start"}
          onSetTopics={lobby.setTopics}
          onSetTargetScore={lobby.setTargetScore}
          onStart={lobby.start}
          onLeave={lobby.leave}
        />
      )}
    </>
  )
}

export { EntryForm }
