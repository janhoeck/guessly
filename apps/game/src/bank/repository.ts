import type { RoundKind, TopicId } from "@guessly/protocol";

/**
 * The round bank's storage seam.
 *
 * Every method is async even though the SQLite implementation underneath is
 * synchronous, because the interface is written for the *next* implementation:
 * swapping SQLite for Postgres has to be one new file that implements this,
 * not a change to every caller. Nothing outside `bank/` may know which one is
 * plugged in.
 */

/** A verified round at rest: content plus everything that scores a guess. */
export interface BankedRound {
  id: number;
  topic: TopicId;
  kind: RoundKind;
  question: string;
  answer: string;
  aliases: string[];
  /** For the server log, same as on a live round. Never broadcast. */
  subject: string;
  /** Lyrics rounds: the paraphrased snippet. Null for image rounds. */
  snippet: string | null;
  /** Image rounds: the file in the image store. Null for lyrics rounds. */
  imageFile: string | null;
  /** Where the image was downloaded from. Attribution; never served. */
  sourceUrl: string | null;
}

export type NewBankedRound = Omit<BankedRound, "id">;

export interface RoundRepository {
  /** Opens the store and applies the schema. Everything else may assume it ran. */
  init(): Promise<void>;
  /**
   * Banks a round. False — not an error — when the bank already holds this
   * topic-and-answer, so a generator repeating itself costs a shrug, not a
   * duplicate a lobby could be served twice in one game.
   *
   * `served` is true when the round is being handed to a lobby in the same
   * breath, so a round played the moment it was made does not also sit at the
   * front of the rotation as if it were fresh.
   */
  insert(round: NewBankedRound, now: number, served: boolean): Promise<boolean>;
  /**
   * One round for a game: matching topic, answer not in `excludeAnswers`
   * (compared case-insensitively — the list is a game's `usedAnswers`), and
   * the least-served candidate first so the pool rotates instead of dealing
   * the same favourite every evening. The draw is recorded before the round
   * is returned. Null when nothing in the bank fits.
   */
  draw(
    topic: TopicId,
    excludeAnswers: readonly string[],
    now: number,
  ): Promise<BankedRound | null>;
  /** How many rounds the bank holds for a topic. The refill worker's gauge. */
  count(topic: TopicId): Promise<number>;
  /** Every answer banked for a topic — a generator's exclusion list. */
  answers(topic: TopicId): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * How answers are compared for deduplication and exclusion. Deliberately
 * simpler than the guess matching in `lobby/matching.ts`: this decides whether
 * two *rounds* are the same round, not whether a player was close enough.
 */
export const answerKey = (answer: string): string => answer.trim().toLowerCase();
