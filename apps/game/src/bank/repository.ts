import type { LanguageId, RoundKind, TopicId } from "@guessly/protocol";

/**
 * The round bank's storage seam.
 *
 * Every method is async even though the SQLite implementation underneath is
 * synchronous, because the interface is written for the *next* implementation:
 * swapping SQLite for Postgres has to be one new file that implements this,
 * not a change to every caller. Nothing outside `bank/` may know which one is
 * plugged in.
 *
 * **A round is one subject and many languages.** What the round *shows* —
 * the picture, or a lyrics round's paraphrase — is the same whoever is
 * looking at it; the question asked about it, the answer to type and the
 * aliases that count are not. So the two are stored apart — one row per
 * round, one row per language — which is what makes adding a language a
 * matter of writing more `texts` rather than a second copy of every round and
 * a second download of every picture.
 */

/** One round as one language reads it. */
export interface BankedRoundText {
  question: string;
  answer: string;
  aliases: string[];
}

/** A verified round at rest: one subject, and every language it was written in. */
export interface BankedRound {
  id: number;
  topic: TopicId;
  kind: RoundKind;
  /** For the server log, same as on a live round. Never broadcast. */
  subject: string;
  /** Image rounds: the file in the image store. Null for lyrics rounds. */
  imageFile: string | null;
  /** Where the image was downloaded from. Attribution; never served. */
  sourceUrl: string | null;
  /**
   * Lyrics rounds: the paraphrase. Null for image rounds.
   *
   * It sits here beside the picture rather than in `texts` because it is
   * written in the *song's* language: an English song reads English in a
   * German lobby, so there is one of it and the shape says so.
   */
  snippet: string | null;
  /** The snippet's BCP 47 tag, when the source gave a usable one. */
  snippetLanguage: string | null;
  /**
   * Keyed by language, and never empty. Partial because a language added
   * after a round was banked is a language that round was not written in —
   * which is a round the new language's lobbies cannot be dealt, not a round
   * that has to be thrown away.
   */
  texts: Partial<Record<LanguageId, BankedRoundText>>;
}

export type NewBankedRound = Omit<BankedRound, "id">;

export interface RoundRepository {
  /** Opens the store and applies the schema. Everything else may assume it ran. */
  init(): Promise<void>;
  /**
   * Banks a round with all of its languages. False — not an error — when the
   * topic already holds this answer in any of them, so a generator repeating
   * itself costs a shrug, not a duplicate a lobby could be served twice in one
   * game.
   *
   * `served` is true when the round is being handed to a lobby in the same
   * breath, so a round played the moment it was made does not also sit at the
   * front of the rotation as if it were fresh.
   */
  insert(round: NewBankedRound, now: number, served: boolean): Promise<boolean>;
  /**
   * One round for a game: matching topic, *written in `language`*, answer not
   * in `excludeAnswers` (compared case-insensitively — the list is a game's
   * `usedAnswers`), and the least-served candidate first so the pool rotates
   * instead of dealing the same favourite every evening. The draw is recorded
   * before the round is returned. Null when nothing fits.
   *
   * The round comes back with *every* language it holds, not just the one
   * asked for: the lobby reads its own, and the others are what let a player
   * be right in either — see `bank/source.ts`.
   */
  draw(
    topic: TopicId,
    language: LanguageId,
    excludeAnswers: readonly string[],
    now: number,
  ): Promise<BankedRound | null>;
  /**
   * How many rounds a topic holds that a lobby playing in `language` could
   * actually be dealt. The refill worker's gauge, and language-aware because
   * a topic full of rounds none of which were written in German is an empty
   * shelf to a German lobby.
   */
  count(topic: TopicId, language: LanguageId): Promise<number>;
  /**
   * Every answer banked for a topic, in every language — a generator's
   * exclusion list. Deliberately not filtered by language: the point is to
   * stop the generator picking a subject the topic already has, and it has it
   * whichever language it was written in.
   */
  answers(topic: TopicId): Promise<string[]>;
  close(): Promise<void>;
}

/**
 * How answers are compared for deduplication and exclusion. Deliberately
 * simpler than the guess matching in `lobby/matching.ts`: this decides whether
 * two *rounds* are the same round, not whether a player was close enough.
 */
export const answerKey = (answer: string): string => answer.trim().toLowerCase();
