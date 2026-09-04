"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { isPlaying } from "@guessly/protocol"

import { useLobby } from "@/components/lobby/use-lobby"
import { FinalStandings } from "@/components/results/final-standings"
import { NextGamePanel } from "@/components/results/next-game"
import { Wordmark } from "@guessly/ui/components/wordmark"
import { Button } from "@guessly/ui/components/ui/button"

/**
 * The results screen, and the only client island on `/<CODE>/results`.
 *
 * Like the game room, its first job is deciding whether this tab belongs on
 * this URL at all. Five things can be true when it mounts — the seat is still
 * being reclaimed, there is no seat, the seat is in a different lobby, the
 * lobby is a plain lobby, or a game is being *played* — and only `finished` is
 * "stay here". The playing case is the one this page adds: the host pressing
 * Play again moves every results screen in the room back to `/<CODE>`, the
 * same way `lobby:start` moved everybody there the first time.
 *
 * Everything below the redirect renders from the server's snapshot and keeps
 * nothing — including the standings, which is why a player reconnecting or a
 * host re-picking topics moves this page with no code of its own.
 */
function ResultsRoom({ code }: { code: string }) {
  const router = useRouter()
  const lobby = useLobby()
  const { state, playerId, settled } = lobby

  /** Distinguishes "left on purpose" from "was never here", and is read while
   *  choosing where to go, so it is state rather than a ref. */
  const [walkedOut, setWalkedOut] = React.useState(false)

  const target = !settled
    ? null
    : !state
      ? walkedOut
        ? "/"
        : // No seat here. The likeliest way in is a stale link, and the join
          // form with the code filled in is the closest thing to helpful.
          `/?code=${code}`
      : state.code !== code
        ? `/${state.code}`
        : state.status === "lobby"
          ? // A lobby being set up is a modal on the landing page, not a page
            // of its own.
            "/"
          : isPlaying(state.status)
            ? // The rematch has opened its countdown. Back to the game.
              `/${code}`
            : null

  React.useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])

  const handleLeave = () => {
    setWalkedOut(true)
    lobby.leave()
    router.replace("/")
  }

  if (target !== null || !state || !playerId) {
    return (
      <main className="grid flex-1 place-items-center px-6 py-16">
        <p className="text-sm text-muted-foreground">Fetching the standings…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Wordmark className="text-lg" />
        <div className="flex items-center gap-4">
          <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Room{" "}
            <span
              className="font-heading text-sm font-semibold text-foreground"
              aria-label={state.code.split("").join(" ")}
            >
              {state.code}
            </span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      </header>

      <div className="grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <FinalStandings
          players={state.players}
          hostId={state.hostId}
          playerId={playerId}
          targetScore={state.targetScore}
          finalRound={state.round}
        />

        <NextGamePanel
          state={state}
          playerId={playerId}
          starting={lobby.pending === "start"}
          onSetTopics={lobby.setTopics}
          onSetLanguage={lobby.setLanguage}
          onSetTargetScore={lobby.setTargetScore}
          onStart={lobby.start}
        />
      </div>
    </main>
  )
}

export { ResultsRoom }
