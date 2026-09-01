"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  err,
  type Ack,
  type LobbyClosedPayload,
  type LobbyState,
  type TopicId,
} from "@guessly/protocol"

import { getSocket } from "@/lib/socket"
import { clearSeat, readSeat, writeSeat } from "@/lib/session"

/**
 * The landing page's connection to the game server, and the one place in the
 * client that talks to it.
 *
 * Everything it exposes is either the server's own snapshot or a function that
 * asks the server to change it. There is deliberately no local copy of the
 * target score or the topic selection to keep in step: the server sends a full
 * snapshot on every mutation, so a control renders `state` and emits, and the
 * broadcast is what moves the UI. That is the whole reason the protocol has no
 * incremental events — a second source of truth here is exactly the drift it
 * exists to prevent.
 */

/** Which request is in flight, so the right button can show it. */
export type LobbyPending = "create" | "join" | "start" | null

export interface Lobby {
  /** The server's snapshot, or null when this tab is not in a lobby. */
  state: LobbyState | null
  /** This tab's seat. Null until a lobby is entered. */
  playerId: string | null
  pending: LobbyPending
  create(nickname: string, targetScore: number, topics: TopicId[]): void
  join(code: string, nickname: string): void
  setTopics(topics: TopicId[]): void
  setTargetScore(targetScore: number): void
  start(): void
  leave(): void
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
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    handle(err<T>("SERVER_ERROR", "The game server is not answering."))
  }, ACK_TIMEOUT_MS)

  return (result) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    handle(result)
  }
}

export function useLobby(): Lobby {
  const [state, setState] = React.useState<LobbyState | null>(null)
  const [playerId, setPlayerId] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState<LobbyPending>(null)

  const forget = React.useCallback(() => {
    clearSeat()
    setState(null)
    setPlayerId(null)
    setPending(null)
  }, [])

  // Snapshots and closures arrive unprompted, so these outlive any one request.
  React.useEffect(() => {
    const socket = getSocket()

    const onState = (next: LobbyState) => setState(next)
    const onClosed = ({ reason }: LobbyClosedPayload) => {
      forget()
      toast.error(
        reason === "idle"
          ? "That lobby sat idle too long and was closed."
          : "Everybody left, so the lobby was closed."
      )
    }

    socket.on("lobby:state", onState)
    socket.on("lobby:closed", onClosed)
    return () => {
      socket.off("lobby:state", onState)
      socket.off("lobby:closed", onClosed)
    }
  }, [forget])

  // Reclaim whatever seat this tab was holding before the reload. A refusal is
  // final by design — the stored seat is worthless, so it goes rather than
  // being retried.
  React.useEffect(() => {
    const seat = readSeat()
    if (!seat) return

    const socket = getSocket()
    socket.connect()
    socket.emit(
      "lobby:resume",
      seat,
      guard((result) => {
        if (!result.ok) {
          clearSeat()
          return
        }
        setState(result.data.state)
        setPlayerId(seat.playerId)
      })
    )
  }, [])

  const create = React.useCallback<Lobby["create"]>(
    (nickname, targetScore, topics) => {
      const socket = getSocket()
      socket.connect()
      setPending("create")
      socket.emit(
        "lobby:create",
        { nickname, targetScore, topics },
        guard((result) => {
          setPending(null)
          if (!result.ok) {
            toast.error(result.message)
            return
          }
          const { code, playerId: id, resumeToken, state: snapshot } = result.data
          writeSeat({ code, playerId: id, resumeToken })
          setPlayerId(id)
          setState(snapshot)
        })
      )
    },
    []
  )

  const join = React.useCallback<Lobby["join"]>((code, nickname) => {
    const socket = getSocket()
    socket.connect()
    setPending("join")
    socket.emit(
      "lobby:join",
      { code, nickname },
      guard((result) => {
        setPending(null)
        if (!result.ok) {
          toast.error(result.message)
          return
        }
        const { playerId: id, resumeToken, state: snapshot } = result.data
        writeSeat({ code: snapshot.code, playerId: id, resumeToken })
        setPlayerId(id)
        setState(snapshot)
      })
    )
  }, [])

  const setTopics = React.useCallback<Lobby["setTopics"]>((topics) => {
    getSocket().emit(
      "lobby:setTopics",
      { topics },
      guard((result) => {
        // The broadcast is what moves the UI, so success needs nothing here.
        if (!result.ok) toast.error(result.message)
      })
    )
  }, [])

  const setTargetScore = React.useCallback<Lobby["setTargetScore"]>(
    (targetScore) => {
      getSocket().emit(
        "lobby:setTarget",
        { targetScore },
        guard((result) => {
          if (!result.ok) toast.error(result.message)
        })
      )
    },
    []
  )

  const start = React.useCallback<Lobby["start"]>(() => {
    setPending("start")
    getSocket().emit(
      "lobby:start",
      guard((result) => {
        setPending(null)
        if (!result.ok) toast.error(result.message)
      })
    )
  }, [])

  const leave = React.useCallback<Lobby["leave"]>(() => {
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
  }, [forget])

  return { state, playerId, pending, create, join, setTopics, setTargetScore, start, leave }
}
