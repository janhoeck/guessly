import type { Ack } from "./errors.js";
import type { LobbyState } from "./lobby.js";
import type { TopicId } from "./topics.js";

export interface CreateLobbyPayload {
  nickname: string;
  targetScore: number;
  /**
   * The host's opening selection. Sent rather than defaulted server-side so a
   * client that offers the choice up front and one that offers it in the lobby
   * both go through the same validation.
   */
  topics: TopicId[];
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

export interface SetTopicsPayload {
  topics: TopicId[];
}

/**
 * A lobby is never closed because the host left — the longest-present remaining
 * player is promoted instead. Both reasons here come from the reaping sweep.
 */
export type LobbyClosedReason = "empty" | "idle";

/**
 * The round could not be built — the content source refused, timed out, or
 * returned nothing reachable. The lobby is already back in `lobby` status by
 * the time this arrives; the snapshot says *what* happened and this says *why*,
 * because "you are suddenly back in the lobby" is not an explanation.
 */
export interface RoundFailedPayload {
  message: string;
}

export interface LobbyClosedPayload {
  reason: LobbyClosedReason;
}

/**
 * Guessing (`round:guess`) is higher-frequency than a lobby mutation and will
 * need a narrower shape than a full snapshot; it is specified with the rest of
 * the scoring loop. Round *lifecycle* — countdown, content, reveal — is two
 * broadcasts a round, so it rides in the snapshot like everything else.
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
  /**
   * Host only, and only while the lobby is being configured rather than
   * played — before the first round, or after a winner, ready for the next
   * game.
   */
  "lobby:setTopics": (
    payload: SetTopicsPayload,
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
  "round:failed": (payload: RoundFailedPayload) => void;
}

/** Reserved for socket.io's server-to-server channel; unused for now. */
export type InterServerEvents = Record<string, never>;

/** Per-connection data the server hangs off the socket once a seat is bound. */
export interface SocketData {
  lobbyCode?: string;
  playerId?: string;
}
