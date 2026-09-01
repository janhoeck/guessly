import type { Ack } from "./errors.js";
import type { LobbyState } from "./lobby.js";

export interface CreateLobbyPayload {
  nickname: string;
  targetScore: number;
}

export interface CreateLobbyResult {
  code: string;
  playerId: string;
  /**
   * 32 random bytes, hex encoded. Sent only to its owner and never broadcast:
   * player IDs are public in the snapshot, so without a secret anyone in the
   * lobby could resume as someone else and inherit their score.
   */
  resumeToken: string;
  state: LobbyState;
}

export interface JoinLobbyPayload {
  code: string;
  nickname: string;
}

export interface JoinLobbyResult {
  playerId: string;
  resumeToken: string;
  state: LobbyState;
}

export interface ResumeLobbyPayload {
  code: string;
  playerId: string;
  resumeToken: string;
}

export interface ResumeLobbyResult {
  state: LobbyState;
}

export interface SetTargetPayload {
  targetScore: number;
}

export type LobbyClosedReason = "host_left" | "empty" | "idle";

export interface LobbyClosedPayload {
  reason: LobbyClosedReason;
}

/**
 * Round events are higher-frequency and may need to be narrower than a full
 * snapshot; they are specified with the game loop, along with `round:guess`.
 */
export interface ClientToServerEvents {
  "lobby:create": (
    payload: CreateLobbyPayload,
    ack: (result: Ack<CreateLobbyResult>) => void,
  ) => void;
  "lobby:join": (
    payload: JoinLobbyPayload,
    ack: (result: Ack<JoinLobbyResult>) => void,
  ) => void;
  "lobby:resume": (
    payload: ResumeLobbyPayload,
    ack: (result: Ack<ResumeLobbyResult>) => void,
  ) => void;
  /** Host only. */
  "lobby:setTarget": (
    payload: SetTargetPayload,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  /** Host only. */
  "lobby:start": (ack: (result: Ack<Record<string, never>>) => void) => void;
  "lobby:leave": (ack: (result: Ack<Record<string, never>>) => void) => void;
}

export interface ServerToClientEvents {
  /** Sent in full on every lobby mutation. There are no incremental events. */
  "lobby:state": (state: LobbyState) => void;
  "lobby:closed": (payload: LobbyClosedPayload) => void;
}

/** Reserved for socket.io's server-to-server channel; unused for now. */
export type InterServerEvents = Record<string, never>;

/** Per-connection data the server hangs off the socket once a seat is bound. */
export interface SocketData {
  lobbyCode?: string;
  playerId?: string;
}
