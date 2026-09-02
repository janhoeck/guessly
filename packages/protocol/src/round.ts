import type { RoundKind, TopicId } from "./topics.js";

/**
 * What a round physically puts on screen.
 *
 * The union is keyed by the same `RoundKind` the topic catalogue carries, so a
 * topic that says it produces images and content that turns out to be lyrics is
 * a compile error rather than a blank plate in front of twelve people.
 *
 * `image` carries a URL and not the bytes: the picture is fetched by each
 * browser straight from wherever it lives, so a round costs the game server one
 * short string instead of a megabyte per player.
 */
interface RoundContentBase {
  /**
   * The line above the content that says what is being asked for — "Which
   * country's flag is this?", "Who sings this?". It is what turns a picture
   * into a round, and it is part of `RoundContent` rather than a sibling of it
   * so that content without a question is not a state this type can express.
   */
  question: string;
}

export type RoundContent =
  | (RoundContentBase & { kind: "image"; imageUrl: string })
  | (RoundContentBase & {
      kind: "lyrics";
      snippet: string;
      /**
       * The language the paraphrase is written in, as a BCP 47 tag, or null
       * when the source did not say.
       *
       * It is the *song's* language and not the lobby's — a German room naming
       * an English song reads English, because half of what makes a lyric
       * recognisable is the language it is in. That makes it the one thing on
       * screen whose language the lobby's own setting does not predict, which
       * is why it rides here: the UI marks the snippet with it so a screen
       * reader does not read English lyrics with a German voice.
       */
      snippetLanguage: string | null;
    });

/**
 * One player's round, once they have got it right.
 *
 * This is public the moment it exists rather than held back to the reveal, and
 * that is the point: watching somebody else's row settle at 1.4 seconds is the
 * pressure the round is made of. It gives nothing away either — knowing that
 * Kim knows the answer is not knowing the answer.
 *
 * There is no entry for a wrong guess. A miss is told to the player who made it
 * and to nobody else, so the room only ever learns who got it.
 */
export interface RoundResult {
  playerId: string;
  /** From `startsAt` to the moment the guess reached the server. */
  elapsedMs: number;
  points: number;
}

/**
 * A round as every player sees it.
 *
 * Two fields are null on purpose rather than absent, and both of them are the
 * whole point of this type:
 *
 * - `content` is null while the round is being sourced. The countdown starts
 *   the moment the host presses start, and the AI answers whenever it answers;
 *   the players are not made to stare at nothing in the meantime.
 * - `answer` is null for as long as guessing is open. This snapshot goes to
 *   everybody, so an answer that appears in it one broadcast early is an answer
 *   on somebody's screen one broadcast early.
 */
export interface RoundState {
  /** 1-based, and the identity every round-scoped transition is checked against. */
  number: number;
  topic: TopicId;
  kind: RoundKind;
  /**
   * When the countdown reaches zero. Server clock — read it against
   * `LobbyState.serverNow` and never against the browser's own, which may be
   * minutes out and would otherwise render a countdown that is simply wrong.
   */
  startsAt: number;
  /** `startsAt + ROUND_DURATION_MS`. Null until the round is actually live. */
  endsAt: number | null;
  /** Null until the content has been sourced. */
  content: RoundContent | null;
  /** Null until the reveal. See the note above. */
  answer: string | null;
  /**
   * Everybody who has answered correctly, in the order they did it — so the
   * first entry is the player who got there first. Empty until somebody does,
   * and never holding a player twice: one seat gets one correct answer.
   */
  results: RoundResult[];
  /**
   * When the intermission after this round ends and the next countdown opens.
   * Null until the reveal, and stamped by the server for the same reason as the
   * two deadlines above it: a gap between rounds that each browser timed for
   * itself would drift a little further apart every round.
   */
  intermissionEndsAt: number | null;
}
