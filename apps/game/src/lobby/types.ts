import type {
  LobbyState,
  LobbyStatus,
  Player,
  RoundContent,
  RoundKind,
  RoundResult,
  RoundState,
  TopicId,
} from "@guessly/protocol";

/**
 * A seat as the server holds it. The two extra fields are the reason this type
 * exists separately from the protocol's `Player`: neither may ever reach the
 * wire, and the projection below is what guarantees that.
 */
export interface PlayerRecord extends Player {
  /** When this seat was taken. Ties with Map insertion order; see promoteHost. */
  joinedAt: number;
  /** The seat's secret. Sent once, to its owner, and never broadcast. */
  resumeToken: string;
}

/**
 * A round as the server holds it. Same trick as `PlayerRecord`: the fields that
 * decide the game — the answer and what else counts as it — live here and are
 * projected out, so the only way to leak an answer early is to edit
 * `toRoundState`.
 */
export interface RoundRecord {
  number: number;
  topic: TopicId;
  kind: RoundKind;
  startsAt: number;
  endsAt: number | null;
  content: RoundContent | null;
  /** Null until the content source answers. */
  answer: string | null;
  /**
   * What else counts as the answer — "USA" for "United States", the artist for
   * a song. It arrives with the answer, and it is the half of answer matching
   * that knows anything about the subject.
   */
  aliases: string[];
  /**
   * Who has answered correctly, in the order they did. Public, unlike the two
   * fields above it: the room is entitled to see who got there first, and
   * seeing that tells nobody what the answer was.
   */
  results: RoundResult[];
  /** The reveal. Until this flips, `answer` does not go on the wire. */
  revealed: boolean;
  /** Stamped at the reveal; when the next countdown opens. */
  intermissionEndsAt: number | null;
}

export interface LobbyRecord {
  code: string;
  status: LobbyStatus;
  targetScore: number;
  hostId: string;
  /** Normalised on the way in: deduplicated and in catalogue order. */
  topics: TopicId[];
  /** Insertion ordered, and never re-inserted, so this is join order. */
  players: Map<string, PlayerRecord>;
  round: RoundRecord | null;
  /**
   * Every answer this game has already used, lower-cased. Handed to the content
   * source so it does not serve the same flag twice in one sitting.
   */
  usedAnswers: string[];
  createdAt: number;
  lastActivityAt: number;
}

/**
 * The one place an answer is allowed to reach the wire, and only once
 * `revealed` says the round is over. Everything else about a round is public
 * from the moment it exists.
 */
function toRoundState(round: RoundRecord | null): RoundState | null {
  if (round === null) return null;
  return {
    number: round.number,
    topic: round.topic,
    kind: round.kind,
    startsAt: round.startsAt,
    endsAt: round.endsAt,
    // Treated as immutable from the moment the source hands it over; nothing
    // downstream of here writes to it.
    content: round.content,
    answer: round.revealed ? round.answer : null,
    // Copied for the same reason as `topics` below: a snapshot on the wire must
    // not be a live handle on the round still being played.
    results: [...round.results],
    intermissionEndsAt: round.intermissionEndsAt,
  };
}

/**
 * The only path from a LobbyRecord to something broadcastable. Each player is
 * rebuilt field by field rather than spread, so adding a secret to
 * `PlayerRecord` cannot silently leak it into every client's snapshot.
 *
 * `now` is a parameter because the snapshot carries the clock the deadlines in
 * it are stamped against — see `LobbyState.serverNow`.
 */
export function toLobbyState(lobby: LobbyRecord, now: number): LobbyState {
  return {
    code: lobby.code,
    status: lobby.status,
    targetScore: lobby.targetScore,
    hostId: lobby.hostId,
    // Copied, not shared: a snapshot handed to the wire must not be a handle
    // on the live lobby's array.
    topics: [...lobby.topics],
    players: [...lobby.players.values()].map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
      disconnectedAt: player.disconnectedAt,
    })),
    round: toRoundState(lobby.round),
    serverNow: now,
  };
}
