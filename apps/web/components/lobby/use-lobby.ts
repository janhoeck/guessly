"use client"

import * as React from "react"
import type { LobbyState, TopicId } from "@guessly/protocol"

import {
  getServerSnapshot,
  getSnapshot,
  lobbyActions,
  subscribe,
  type LobbyPending,
} from "@/lib/lobby-client"

/**
 * React's view of the connection in `lib/lobby-client`.
 *
 * The connection deliberately lives outside the component tree — see the note
 * there — so this hook is only the subscription: it renders whatever the last
 * snapshot said and hands back the functions that ask the server to change it.
 *
 * There is still no local copy of the target score or the topic selection to
 * keep in step. The server sends a full snapshot on every mutation, so a control
 * renders `state` and emits, and the broadcast is what moves the UI. That is the
 * whole reason the protocol has no incremental events.
 */

export type { LobbyPending }

export interface Lobby {
  /** The server's snapshot, or null when this tab is not in a lobby. */
  state: LobbyState | null
  /** This tab's seat. Null until a lobby is entered. */
  playerId: string | null
  pending: LobbyPending
  /** False only while a stored seat is still being reclaimed. */
  settled: boolean
  create(nickname: string, targetScore: number, topics: TopicId[]): void
  join(code: string, nickname: string): void
  setTopics(topics: TopicId[]): void
  setTargetScore(targetScore: number): void
  start(): void
  leave(): void
}

export function useLobby(): Lobby {
  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
  return { ...snapshot, ...lobbyActions }
}
