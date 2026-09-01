export type ErrorCode =
  | "LOBBY_NOT_FOUND"
  | "LOBBY_FULL"
  | "GAME_IN_PROGRESS"
  | "NICKNAME_TAKEN"
  | "INVALID_NICKNAME"
  | "NOT_HOST"
  | "RATE_LIMITED"
  /** Client clears sessionStorage and returns to the join screen. */
  | "RESUME_REJECTED";

/** Every client to server event acks with one of these, so nothing throws across the wire. */
export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };

export const ok = <T>(data: T): Ack<T> => ({ ok: true, data });

export const err = <T = never>(error: ErrorCode, message: string): Ack<T> => ({
  ok: false,
  error,
  message,
});
