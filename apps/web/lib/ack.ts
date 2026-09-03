"use client"

import { err, type Ack } from "@guessly/protocol"

/**
 * Every client to server event acks with a Result, so nothing throws across the
 * wire — but a server that never answers sends no Result at all, and a caller
 * waiting on one has no way to tell that apart from a slow reply.
 *
 * `guard` turns silence into the same shape as a refusal, so every caller has
 * one path to handle instead of two.
 *
 * It lives here rather than beside either connection because both of them need
 * it: the lobby's socket in `lib/lobby-client.ts`, and the browse list's in
 * `lib/lobby-list.ts`. It knows nothing about lobbies.
 */

/**
 * Long enough to cover a cold connection, short enough that a dead server does
 * not leave a button spinning. Socket.IO buffers an emit made while the socket
 * is still connecting, so this covers the connect and the round trip together.
 */
export const ACK_TIMEOUT_MS = 8_000

export function guard<T>(
  handle: (result: Ack<T>) => void
): (result: Ack<T>) => void {
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
