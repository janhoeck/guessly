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
  | (RoundContentBase & { kind: "lyrics"; snippet: string });

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
}
