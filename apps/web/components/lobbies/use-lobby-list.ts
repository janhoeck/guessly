"use client"

import * as React from "react"

import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type LobbyListSnapshot,
} from "@/lib/lobby-list"

/**
 * React's view of the browse subscription in `lib/lobby-list`.
 *
 * The same shape as `useLobby`, and for the same reason: the connection lives
 * outside the component tree, and this is only the subscription to it. There is
 * nothing to return but the last list the server sent — the browse screen has
 * no state of its own to keep.
 */

export type { LobbyListSnapshot }

export function useLobbyList(): LobbyListSnapshot {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
