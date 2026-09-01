import type { TopicId } from "./topics.js";

export type LobbyStatus = "lobby" | "in_round" | "intermission" | "finished";

export interface Player {
  /** Server-issued; this is the seat identity. */
  id: string;
  nickname: string;
  score: number;
  connected: boolean;
  disconnectedAt: number | null;
}

/**
 * The snapshot broadcast on every lobby mutation. Serializable by
 * construction — players are an array here, not the server's Map — and it
 * never carries a resume token, which is only ever sent to its owner.
 *
 * The in-round fields land here once the game loop is specified.
 */
export interface LobbyState {
  code: string;
  status: LobbyStatus;
  targetScore: number;
  hostId: string;
  /**
   * What rounds may be about. Always at least one, always in catalogue order,
   * and public because every player is entitled to know what they are in for.
   */
  topics: TopicId[];
  players: Player[];
}
