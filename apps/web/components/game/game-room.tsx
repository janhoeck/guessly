"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { Countdown } from "@/components/game/countdown"
import { RoundStage } from "@/components/game/round-stage"
import { Scoreboard } from "@/components/game/scoreboard"
import { useLobby } from "@/components/lobby/use-lobby"
import { Wordmark } from "@/components/site/wordmark"
import { Button } from "@/components/ui/button"

/**
 * The game screen, and the only client island on `/<CODE>`.
 *
 * It owns one decision the lobby modal never had to make: whether this tab
 * belongs on this URL at all. Five things can be true when it mounts — the seat
 * is still being reclaimed, there is no seat, the seat is in a different lobby,
 * the lobby has gone back to being a lobby, or the game has been won — and only
 * one of them is "stay here". They are resolved into a single route to go to, so
 * the redirect is one value to read rather than five branches to follow.
 *
 * Everything below that renders from the server's snapshot and keeps nothing.
 */
function GameRoom({ code }: { code: string }) {
  const router = useRouter()
  const { state, playerId, settled, guess, leave } = useLobby()

  /** Distinguishes "left on purpose" from "was never here", and is read while
   *  choosing where to go, so it is state rather than a ref. */
  const [walkedOut, setWalkedOut] = React.useState(false)

  const target = !settled
    ? null
    : !state
      ? walkedOut
        ? "/"
        : // The usual way to reach this URL without a seat is a link somebody
          // pasted into the group chat, so the code goes with them to the join
          // form rather than being dropped on the floor.
          `/?code=${code}`
      : state.code !== code
        ? // In a lobby, but not this one. The lobby wins — it is the one with
          // people in it.
          `/${state.code}`
        : state.status === "lobby"
          ? // Either the host has not started, or the round could not be built
            // and everybody has been put back. The lobby is a modal on `/`.
            "/"
          : state.status === "finished"
            ? // Somebody reached the target. A result is a thing you look at
              // rather than a state the board is left in, so it has a page.
              `/${code}/results`
            : null

  React.useEffect(() => {
    if (target) router.replace(target)
  }, [target, router])

  const handleLeave = () => {
    setWalkedOut(true)
    leave()
    router.replace("/")
  }

  // The frame before a redirect lands, and the one while a reload is still
  // reclaiming its seat. Both are a moment long and neither is worth a spinner.
  if (target !== null || !state || !playerId) {
    return (
      <main className="grid flex-1 place-items-center px-6 py-16">
        <p className="text-sm text-muted-foreground">Getting you back into the game…</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-8">
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

      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        {/* A fixed height rather than a minimum, and it is the whole point of
            the game screen's layout: the panel is the same box in every phase
            and for every round, so the countdown does not resize into the
            round, a two-line question does not move the guess field, and a
            portrait photograph cannot push it off the bottom of the screen.
            Everything variable is absorbed inside, by the media area.
            `9rem` is the chrome above and below — the header, the gap and the
            page padding — so the panel fills the viewport and stops there. */}
        <div className="flex h-[clamp(24rem,calc(100dvh-9rem),46rem)] flex-col">
          {state.round === null ? (
            <section className="grid flex-1 place-items-center rounded-xl bg-card p-8 ring-1 ring-foreground/10">
              <p className="text-sm text-muted-foreground">Setting the round up…</p>
            </section>
          ) : state.status === "countdown" ? (
            <Countdown round={state.round} />
          ) : (
            <RoundStage
              round={state.round}
              players={state.players}
              playerId={playerId}
              targetScore={state.targetScore}
              onGuess={guess}
            />
          )}
        </div>

        <Scoreboard
          players={state.players}
          hostId={state.hostId}
          playerId={playerId}
          targetScore={state.targetScore}
          round={state.round}
        />
      </div>
    </main>
  )
}

export { GameRoom }
