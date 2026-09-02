export type ErrorCode =
  | "LOBBY_NOT_FOUND"
  | "LOBBY_FULL"
  | "GAME_IN_PROGRESS"
  | "NICKNAME_TAKEN"
  | "INVALID_NICKNAME"
  | "INVALID_TARGET_SCORE"
  | "INVALID_TOPICS"
  | "NOT_HOST"
  | "NOT_ENOUGH_PLAYERS"
  /** A guess arrived for a round that is not taking any: too early, or over. */
  | "ROUND_NOT_OPEN"
  /** One seat gets one correct answer, and this seat has already had it. */
  | "ALREADY_ANSWERED"
  | "INVALID_GUESS"
  | "RATE_LIMITED"
  /** Client clears sessionStorage and returns to the join screen. */
  | "RESUME_REJECTED"
  /**
   * The server failed in a way the client cannot fix. It exists so a bug can
   * never leave a caller waiting on an ack that will not arrive.
   */
  | "SERVER_ERROR";

/** Every client to server event acks with one of these, so nothing throws across the wire. */
export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };

/** The failure half of an Ack, assignable to an Ack of any payload. */
export type AckFailure = Extract<Ack<never>, { ok: false }>;

export const ok = <T>(data: T): Ack<T> => ({ ok: true, data });

export const err = <T = never>(error: ErrorCode, message: string): Ack<T> => ({
  ok: false,
  error,
  message,
});
