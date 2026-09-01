import type { RoundState } from "./round.js";
import type { TopicId } from "./topics.js";

/**
 * `countdown` is the beat between the host pressing start and round one
 * appearing. It is a status of its own rather than an early `in_round` because
 * the two differ in what they are waiting on: a countdown waits on a clock, a
 * round waits on twelve people typing.
 */
export type LobbyStatus =
  | "lobby"
  | "countdown"
  | "in_round"
  | "intermission"
  | "finished";

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
  /** Null while the lobby is being set up rather than played. */
  round: RoundState | null;
  /**
   * The server's clock at the instant this snapshot was built.
   *
   * Every deadline in the snapshot is stamped against this same clock, so a
   * client subtracts its own offset once — `serverNow - Date.now()` — and
   * renders a correct countdown even if its system time is minutes out. Without
   * it, absolute deadlines are only as trustworthy as the least well set clock
   * in the room, and speed is the score here.
   */
  serverNow: number;
}
