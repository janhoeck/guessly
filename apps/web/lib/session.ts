"use client"

import { ROOM_CODE_LENGTH, type ResumeLobbyPayload } from "@guessly/protocol"

/**
 * The seat this tab is holding, parked where a reload can find it.
 *
 * `sessionStorage` rather than `localStorage` on purpose: a seat belongs to one
 * tab. Two tabs sharing one would fight over the same socket — the server binds
 * a seat to a single live socket and evicts the loser — and opening a second
 * tab to join your own lobby as a second player is exactly what somebody will
 * try first.
 *
 * The shape stored is `ResumeLobbyPayload` itself, so what comes back out is
 * already the thing `lobby:resume` takes.
 */

const KEY = "guessly:seat"

export type Seat = ResumeLobbyPayload

/**
 * Storage is a hostile input like any other: it survives deploys, it is
 * editable by hand, and a half-written value is indistinguishable from a real
 * one until it is checked.
 */
function isSeat(value: unknown): value is Seat {
  if (typeof value !== "object" || value === null) return false
  const { code, playerId, resumeToken } = value as Record<string, unknown>
  return (
    typeof code === "string" &&
    code.length === ROOM_CODE_LENGTH &&
    typeof playerId === "string" &&
    playerId.length > 0 &&
    typeof resumeToken === "string" &&
    resumeToken.length > 0
  )
}

/**
 * Safari in private mode throws on `sessionStorage` rather than returning null,
 * and a browser with storage switched off does the same. Losing the seat is a
 * worse experience, not a broken one, so every access here degrades to "no
 * seat" instead of taking the page down with it.
 */
function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function readSeat(): Seat | null {
  const store = storage()
  if (!store) return null
  try {
    const raw = store.getItem(KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isSeat(parsed)) {
      store.removeItem(KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeSeat(seat: Seat): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(seat))
  } catch {
    // See storage(): a seat that cannot be saved just means no resume.
  }
}

export function clearSeat(): void {
  try {
    storage()?.removeItem(KEY)
  } catch {
    // Nothing to do; the seat is already unreachable.
  }
}
