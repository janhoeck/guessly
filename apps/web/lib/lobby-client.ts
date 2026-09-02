"use client"

import { toast } from "sonner"
import {
  err,
  type Ack,
  type GuessResult,
  type LobbyState,
  type TopicId,
} from "@guessly/protocol"

import { clearSeat, readSeat, writeSeat } from "@/lib/session"
import { getSocket } from "@/lib/socket"

/**
 * The client's one connection to the game server, and the state it produces.
 *
 * This is a module singleton rather than React state, and the reason is the
 * navigation: the lobby is a modal on `/`, a running game is a page at
 * `/<CODE>`, and pressing start moves everybody across that boundary. A
 * connection that lived inside either page's component tree would be torn down
 * and rebuilt in the middle of the countdown — a resume round trip, a blank
 * screen, and a clock that has moved on by the time it comes back. Living out
 * here, it does not notice the navigation at all.
 *
 * It is still not a second source of truth. The only thing kept is the last
 * snapshot the server sent, replaced whole each time another arrives — which is
 * the same rule every component follows, just one level further out.
 */

/** Which request is in flight, so the right button can show it. */
export type LobbyPending = "create" | "join" | "start" | null

/**
 * What came back from a guess, or null when nothing did — the round had already
 * closed, or the server never answered. Either way the player has been told, and
 * null exists so the field can stop waiting rather than sit disabled forever.
 */
export type GuessOutcome = GuessResult | null

export interface LobbySnapshot {
  /** The server's snapshot, or null when this tab is not in a lobby. */
  state: LobbyState | null
  /** This tab's seat. Null until a lobby is entered. */
  playerId: string | null
  pending: LobbyPending
  /**
   * False until the seat this tab was holding has been reclaimed or given up
   * on. The game page needs to tell "not in a lobby" apart from "not in a
   * lobby *yet*" — the first is a redirect home, the second is a reload in
   * progress.
   */
  settled: boolean
}

/** Referentially stable, which is what `useSyncExternalStore` is owed. */
const EMPTY: LobbySnapshot = {
  state: null,
  playerId: null,
  pending: null,
  settled: false,
}

let snapshot: LobbySnapshot = EMPTY
const listeners = new Set<() => void>()

function set(patch: Partial<LobbySnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

/**
 * How far this browser's clock is from the server's, remeasured on every
 * snapshot.
 *
 * Every deadline the server sends is stamped against the clock in the same
 * snapshot, so one subtraction is enough: a laptop that is four minutes fast
 * still renders a correct countdown. Latency is ignored on purpose — it is tens
 * of milliseconds against a twenty second round, and correcting for it would
 * mean a round trip nobody would notice the benefit of.
 */
let clockOffset = 0

export function serverNow(): number {
  return Date.now() + clockOffset
}

function receive(state: LobbyState): void {
  clockOffset = state.serverNow - Date.now()
  set({ state })
}

/**
 * Long enough to cover a cold connection, short enough that a dead server does
 * not leave a button spinning. Socket.IO buffers an emit made while the socket
 * is still connecting, so this covers the connect and the round trip together.
 */
const ACK_TIMEOUT_MS = 8_000

/**
 * Every ack is a Result, but a server that never answers sends no Result at
 * all. This turns silence into one — the same shape, so callers have a single
 * path to handle.
 */
function guard<T>(handle: (result: Ack<T>) => void): (result: Ack<T>) => void {
  let settledOnce = false
  const timer = setTimeout(() => {
    if (settledOnce) return
    settledOnce = true
    handle(err<T>("SERVER_ERROR", "The game server is not answering."))
  }, ACK_TIMEOUT_MS)

  return (result) => {
    if (settledOnce) return
    settledOnce = true
    clearTimeout(timer)
    handle(result)
  }
}

function forget(): void {
  clearSeat()
  set({ state: null, playerId: null, pending: null, settled: true })
}

let resumeAttempted = false

/**
 * Reclaim whatever seat this tab was holding before the reload. A refusal is
 * final by design — the stored seat is worthless, so it goes rather than being
 * retried — and either way the tab ends up settled, which is what unblocks the
 * game page.
 */
function resume(): void {
  if (resumeAttempted) return
  resumeAttempted = true

  const seat = readSeat()
  if (!seat) {
    set({ settled: true })
    return
  }

  const socket = getSocket()
  socket.connect()
  socket.emit(
    "lobby:resume",
    seat,
    guard((result) => {
      if (!result.ok) {
        clearSeat()
        set({ settled: true })
        return
      }
      clockOffset = result.data.state.serverNow - Date.now()
      set({ state: result.data.state, playerId: seat.playerId, settled: true })
    })
  )
}

let attached = false

/**
 * Wired once and never unwired: snapshots, closures and round failures arrive
 * unprompted, and there is no moment in this tab's life when the right response
 * to one is to have stopped listening.
 */
function attach(): void {
  if (attached) return
  attached = true

  const socket = getSocket()

  socket.on("lobby:state", receive)

  socket.on("lobby:closed", ({ reason }) => {
    forget()
    toast.error(
      reason === "idle"
        ? "That lobby sat idle too long and was closed."
        : "Everybody left, so the lobby was closed."
    )
  })

  // The lobby is already back in the snapshot by the time this lands. This is
  // the half that says why, because being returned to the lobby with no
  // explanation reads like a bug.
  socket.on("round:failed", ({ message }) => toast.error(message))

  resume()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  attach()
  return () => {
    listeners.delete(listener)
  }
}

export function getSnapshot(): LobbySnapshot {
  return snapshot
}

/** Nothing has connected during a server render, and nothing may pretend to. */
export function getServerSnapshot(): LobbySnapshot {
  return EMPTY
}

export const lobbyActions = {
  create(nickname: string, targetScore: number, topics: TopicId[]): void {
    const socket = getSocket()
    socket.connect()
    set({ pending: "create" })
    socket.emit(
      "lobby:create",
      { nickname, targetScore, topics },
      guard((result) => {
        if (!result.ok) {
          set({ pending: null })
          toast.error(result.message)
          return
        }
        const { code, playerId, resumeToken, state } = result.data
        writeSeat({ code, playerId, resumeToken })
        clockOffset = state.serverNow - Date.now()
        set({ pending: null, playerId, state, settled: true })
      })
    )
  },

  join(code: string, nickname: string): void {
    const socket = getSocket()
    socket.connect()
    set({ pending: "join" })
    socket.emit(
      "lobby:join",
      { code, nickname },
      guard((result) => {
        if (!result.ok) {
          set({ pending: null })
          toast.error(result.message)
          return
        }
        const { playerId, resumeToken, state } = result.data
        writeSeat({ code: state.code, playerId, resumeToken })
        clockOffset = state.serverNow - Date.now()
        set({ pending: null, playerId, state, settled: true })
      })
    )
  },

  setTopics(topics: TopicId[]): void {
    getSocket().emit(
      "lobby:setTopics",
      { topics },
      guard((result) => {
        // The broadcast is what moves the UI, so success needs nothing here.
        if (!result.ok) toast.error(result.message)
      })
    )
  },

  setTargetScore(targetScore: number): void {
    getSocket().emit(
      "lobby:setTarget",
      { targetScore },
      guard((result) => {
        if (!result.ok) toast.error(result.message)
      })
    )
  },

  start(): void {
    set({ pending: "start" })
    getSocket().emit(
      "lobby:start",
      guard((result) => {
        set({ pending: null })
        if (!result.ok) toast.error(result.message)
      })
    )
  },

  /**
   * One guess. The result goes to the caller rather than into the snapshot,
   * because a miss is the only thing in this game the server tells exactly one
   * person — and the field that has to clear and shake is the one that sent it.
   */
  guess(roundNumber: number, text: string, settle: (outcome: GuessOutcome) => void): void {
    getSocket().emit(
      "round:guess",
      { roundNumber, guess: text },
      guard<GuessResult>((result) => {
        if (!result.ok) {
          // A guess typed as the clock ran out is the common one here, and it
          // is worth saying rather than swallowing.
          toast.error(result.message)
          settle(null)
          return
        }
        settle(result.data)
      })
    )
  },

  leave(): void {
    // The socket stays open. Closing it here would race the emit that has just
    // been written to it, and a player back on the landing page is the most
    // likely person in the world to make another lobby in a moment.
    getSocket().emit(
      "lobby:leave",
      guard(() => {
        // Leaving cannot fail in a way the player can act on: either the seat
        // was freed or it was already gone.
      })
    )
    forget()
  },
}
