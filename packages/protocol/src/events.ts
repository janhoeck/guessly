import type { Ack } from "./errors.js";
import type { LanguageId } from "./languages.js";
import type { LobbyState, LobbySummary } from "./lobby.js";
import type { RoundVote } from "./round.js";
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
  /**
   * What language to write the rounds in. Sent rather than defaulted
   * server-side for the same reason as the topics above: one validation path,
   * whether the client asked up front or offers it in the lobby.
   */
  language: LanguageId;
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

/**
 * Every lobby worth knocking on, in the order the server wants them read: the
 * ones that will let you in first, newest first within that.
 *
 * It is the browse screen's whole state, sent whole — the same rule the lobby
 * snapshot follows and for the same reason. A list of a few dozen short rows is
 * cheaper to resend than a set of incremental events would be to get right.
 */
export interface LobbyListPayload {
  lobbies: LobbySummary[];
}

export interface SetTargetPayload {
  targetScore: number;
}

export interface SetTopicsPayload {
  topics: TopicId[];
}

export interface SetLanguagePayload {
  language: LanguageId;
}

export interface GuessPayload {
  /**
   * Which round this is an answer to, quoted back from the snapshot. A guess
   * typed as the clock ran out arrives after the round it was meant for has
   * gone, and this is what stops it being scored against the next one.
   */
  roundNumber: number;
  guess: string;
}

/**
 * What the guesser alone is told.
 *
 * A correct answer reaches the room through the snapshot, as a `RoundResult`
 * everybody can see. A wrong one goes nowhere else at all: this ack is the only
 * report of a miss that exists, which is why the field can shake without the
 * rest of the room being shown who fumbled it.
 */
export type GuessResult =
  | { correct: false }
  | { correct: true; points: number; elapsedMs: number };

export interface VotePayload {
  /**
   * Which round is being judged, quoted back from the snapshot for the same
   * reason a guess quotes it: the intermission is five seconds long, and a
   * thumb that lands after the next countdown has opened must not be filed
   * against a round the voter has not seen yet.
   */
  roundNumber: number;
  vote: RoundVote;
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
 * `round:guess` is the one event with a payload of its own rather than a lobby
 * mutation that ends in a snapshot, and the reason is frequency: it is several
 * a round per player against two broadcasts a round for everything else. Round
 * *lifecycle* — countdown, content, reveal, intermission — rides in the
 * snapshot like the rest.
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
  /**
   * Start watching the list of open lobbies, and get it back in the ack so the
   * page has something to render without waiting for a push.
   *
   * A subscription rather than a poll: the list changes when somebody creates,
   * joins, leaves or starts a game, and those are exactly the moments a browser
   * wants to see. It is also the one client event that is not about a lobby you
   * are in, so it needs no seat.
   */
  "lobby:browse": (ack: (result: Ack<LobbyListPayload>) => void) => void;
  /**
   * Stop watching. Sent when the browse screen goes away, so a tab that has
   * moved on is not pushed a list nobody is looking at.
   */
  "lobby:unbrowse": (ack: (result: Ack<Record<string, never>>) => void) => void;
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
  /**
   * Host only, and — like the topics — only while the lobby is being set up.
   * A running game is already matching guesses against answers written in one
   * language, so switching mid-game would mean a round whose content and whose
   * scoring disagreed.
   */
  "lobby:setLanguage": (
    payload: SetLanguagePayload,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  /** Host only. */
  "lobby:start": (ack: (result: Ack<Record<string, never>>) => void) => void;
  /**
   * One guess. There is no limit on how many a player may make inside the
   * twenty seconds — the per-socket rate limit is the only ceiling — but a
   * correct one closes the seat's account for that round.
   */
  "round:guess": (
    payload: GuessPayload,
    ack: (result: Ack<GuessResult>) => void,
  ) => void;
  /**
   * One verdict on the round just revealed — thumbs up or down — accepted
   * from the reveal until the next countdown opens, and once per seat. Like
   * a guess, it is answered in the ack alone: a vote is between the player
   * and the bank, and nothing about it rides in the snapshot.
   */
  "round:vote": (
    payload: VotePayload,
    ack: (result: Ack<Record<string, never>>) => void,
  ) => void;
  "lobby:leave": (ack: (result: Ack<Record<string, never>>) => void) => void;
}

export interface ServerToClientEvents {
  /** Sent in full on every lobby mutation. There are no incremental events. */
  "lobby:state": (state: LobbyState) => void;
  "lobby:closed": (payload: LobbyClosedPayload) => void;
  /**
   * The browse list, in full, to whoever is watching it. Sent only when it has
   * actually changed: a room of twelve people guessing mutates its lobby
   * constantly and changes nothing a browser can see.
   */
  "lobby:list": (payload: LobbyListPayload) => void;
  "round:failed": (payload: RoundFailedPayload) => void;
}

/** Reserved for socket.io's server-to-server channel; unused for now. */
export type InterServerEvents = Record<string, never>;

/** Per-connection data the server hangs off the socket once a seat is bound. */
export interface SocketData {
  lobbyCode?: string;
  playerId?: string;
}
