"use client";

import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@guessly/protocol";

/** Note the swap: what the server emits is what this client listens for. */
export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:3001";

let socket: GameSocket | null = null;

/**
 * One socket per browser tab. Connecting is left to the caller so a page can
 * mount before a player has a seat to resume.
 */
export function getSocket(): GameSocket {
  socket ??= io(SOCKET_URL, { autoConnect: false });
  return socket;
}
