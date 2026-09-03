"use client"

import type { LobbySummary } from "@guessly/protocol"

import { guard } from "@/lib/ack"
import { getSocket } from "@/lib/socket"

/**
 * The browse list, on the same socket the lobby uses and by the same rules.
 *
 * A module singleton like `lib/lobby-client`, and for a smaller version of the
 * same reason: the list is server state, so there is one copy of it and it is
 * replaced whole. Nothing here derives anything — which row may be joined is
 * the server's answer, sent as `joinable`, because the rule that decides it is
 * the same rule `lobby:join` will apply a moment later.
 *
 * The subscription is scoped to whoever is looking. The first listener asks the
 * server to start pushing and the last one asks it to stop, so a tab that has
 * navigated away from the browse screen is not being sent lists nobody will
 * render.
 */

export interface LobbyListSnapshot {
  /**
   * Null until the server has answered for the first time. That is "still
   * looking", which is not the same thing as an empty list, and the screen says
   * two different things about them.
   */
  lobbies: LobbySummary[] | null
  /**
   * The server could not be reached. Whatever `lobbies` holds is then the last
   * thing that was true rather than what is true now, which is worth saying out
   * loud rather than leaving on screen as if it were live.
   */
  unreachable: boolean
}

/** Referentially stable, which is what `useSyncExternalStore` is owed. */
const EMPTY: LobbyListSnapshot = { lobbies: null, unreachable: false }

let snapshot: LobbyListSnapshot = EMPTY
const listeners = new Set<() => void>()

function set(next: LobbyListSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * Ask for the list and start being pushed it.
 *
 * Called again on reconnect: the browse room belongs to the socket that joined
 * it, so a connection that drops takes the subscription with it and a client
 * that did not re-ask would sit on a list that had quietly stopped updating.
 */
function browse(): void {
  getSocket().emit(
    "lobby:browse",
    guard((result) => {
      if (!result.ok) {
        set({ lobbies: snapshot.lobbies, unreachable: true })
        return
      }
      set({ lobbies: result.data.lobbies, unreachable: false })
    })
  )
}

let attached = false
/** Whether the server should be pushing to this tab at all. */
let browsing = false

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  if (!attached) {
    attached = true
    const socket = getSocket()
    socket.on("lobby:list", ({ lobbies }) => set({ lobbies, unreachable: false }))
    socket.on("connect", () => {
      if (browsing) browse()
    })
  }

  if (!browsing) {
    browsing = true
    getSocket().connect()
    browse()
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return

    browsing = false
    // The socket stays open — this tab is very likely about to join one of the
    // lobbies it was just shown, and that runs over the same connection.
    getSocket().emit(
      "lobby:unbrowse",
      guard(() => {
        // Nothing to do either way: the pushes have stopped or they never
        // started, and neither is something the page can act on.
      })
    )
  }
}

export function getSnapshot(): LobbyListSnapshot {
  return snapshot
}

/** Nothing has connected during a server render, and nothing may pretend to. */
export function getServerSnapshot(): LobbyListSnapshot {
  return EMPTY
}
