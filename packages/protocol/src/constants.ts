/** Room codes are read aloud over voice chat, so I, L, O, 0 and 1 are excluded. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Is this shaped like a code the server could have issued? Shared rather than
 * rewritten per route, so every page that has to 404 on a typo refuses exactly
 * the same set of strings.
 */
export const isRoomCode = (value: string): boolean => ROOM_CODE_PATTERN.test(value);

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

/**
 * What a correct answer is worth the instant the content appears, and what it
 * is worth on the buzzer. Points fall linearly between them: speed is what
 * separates players, but being right is never worth nothing.
 *
 * The spread is deliberately narrow against DEFAULT_TARGET_SCORE. Perfect play
 * takes five rounds and slow play takes twenty, which is the length a party
 * game wants to be — a curve topping out near the target would make round one
 * the whole game.
 */
export const ROUND_MAX_POINTS = 20;
export const ROUND_MIN_POINTS = 5;

/**
 * How long the answer and the standings stay up before the next round's
 * countdown opens. Long enough to read who beat you to it, short enough that
 * nobody starts a conversation.
 */
export const INTERMISSION_DURATION_MS = 5_000;

/**
 * The longest guess worth reading. The content source is already held to an
 * answer short enough to type in a few seconds, so anything past this is
 * somebody pasting an essay into the field.
 */
export const GUESS_MAX_LENGTH = 80;

/**
 * The beat between "start" and the first round: long enough for everybody to
 * land on the game screen and look up, short enough that nobody wanders off.
 * It runs whether or not the content is ready, so the wait for the AI is spent
 * on a countdown rather than on a spinner.
 */
export const COUNTDOWN_DURATION_MS = 3_000;

/** Before the game starts, a dropped player loses their seat this fast. */
export const LOBBY_DISCONNECT_GRACE_MS = 60_000;

/** How often the reaping sweep runs, and what it reaps. */
export const SWEEP_INTERVAL_MS = 60_000;
export const EMPTY_LOBBY_TTL_MS = 5 * 60_000;
export const IDLE_LOBBY_TTL_MS = 60 * 60_000;

/** Per-socket event budget; one spammer must not wedge the event loop. */
export const RATE_LIMIT_EVENTS_PER_SEC = 20;
