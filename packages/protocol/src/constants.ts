/** Room codes are read aloud over voice chat, so I, L, O, 0 and 1 are excluded. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export const MAX_PLAYERS_PER_LOBBY = 12;

/** Guessing alone is not a party game, so the host cannot start on their own. */
export const MIN_PLAYERS_TO_START = 2;

export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 16;

export const DEFAULT_TARGET_SCORE = 100;

/**
 * The bounds a host-set target is validated against. Both are arbitrary — they
 * exist so the server has something to reject and the UI has something to
 * render, rather than each inventing its own limit.
 */
export const MIN_TARGET_SCORE = 50;
export const MAX_TARGET_SCORE = 500;

/** Players have this long to type a guess once the content is shown. */
export const ROUND_DURATION_MS = 20_000;

/** Before the game starts, a dropped player loses their seat this fast. */
export const LOBBY_DISCONNECT_GRACE_MS = 60_000;

/** How often the reaping sweep runs, and what it reaps. */
export const SWEEP_INTERVAL_MS = 60_000;
export const EMPTY_LOBBY_TTL_MS = 5 * 60_000;
export const IDLE_LOBBY_TTL_MS = 60 * 60_000;

/** Per-socket event budget; one spammer must not wedge the event loop. */
export const RATE_LIMIT_EVENTS_PER_SEC = 20;
