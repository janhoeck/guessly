"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { LobbyDialog } from "@/components/lobby/lobby-dialog"
import { useLobby } from "@/components/lobby/use-lobby"

/**
 * The lobby you are in, wherever you happen to be standing when you get into
 * one.
 *
 * A lobby is a room rather than a page — see the dialog itself — so it opens
 * over whatever screen was used to enter it: the landing page's entry form, or
 * the browse list. Both need exactly the same two things, and neither should
 * argue them separately: the dialog, and the one navigation that closes it for
 * real.
 *
 * That navigation is the whole reason this is a component and not a fragment of
 * markup. The moment the lobby stops being a lobby, everybody in it — host and
 * guests alike — is moved to `/<CODE>`, because a game is a place you are at
 * rather than a dialog over the page that sold it to you. `finished` counts too:
 * the game room forwards it on to the results screen, so there is one rule here
 * rather than a list of statuses to keep in step.
 *
 * The connection does not notice any of this. It lives outside the component
 * tree for exactly this reason, so the tab crossing from `/` or `/lobbies` to
 * `/<CODE>` costs nothing.
 */
function LobbyPresence() {
  const router = useRouter()
  const lobby = useLobby()

  const startedCode =
    lobby.state && lobby.state.status !== "lobby" ? lobby.state.code : null

  // `replace` rather than `push`: the page behind would immediately send a
  // player who pressed Back straight forward again, which is a trap rather
  // than a history entry.
  React.useEffect(() => {
    if (startedCode) router.replace(`/${startedCode}`)
  }, [startedCode, router])

  if (!lobby.state || !lobby.playerId || lobby.state.status !== "lobby") {
    return null
  }

  return (
    <LobbyDialog
      state={lobby.state}
      playerId={lobby.playerId}
      starting={lobby.pending === "start"}
      onSetTopics={lobby.setTopics}
      onSetLanguage={lobby.setLanguage}
      onSetTargetScore={lobby.setTargetScore}
      onStart={lobby.start}
      onLeave={lobby.leave}
    />
  )
}

export { LobbyPresence }
