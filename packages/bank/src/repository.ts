import type { LanguageId, RoundKind, RoundVote, TopicId } from "@guessly/protocol";

/**
 * The round bank's storage seam.
 *
 * Every method is async, so a different store underneath is one new file that
 * implements this rather than a change to every caller. Nothing outside
 * `bank/` may know which one is plugged in.
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

/**
 * How a round has been received: thumbs up and thumbs down, across every
 * lobby it was dealt to. Both zero for a round nobody has judged yet.
 */
export interface RoundVoteTally {
  up: number;
  down: number;
}

/**
 * One thumb, as the game server hands it over the moment a player casts it.
 * The round it is about, the language the lobby was reading it in, and when —
 * the server's clock, like every other timestamp in the bank.
 */
export interface NewRoundVote {
  roundId: number;
  language: LanguageId;
  vote: RoundVote;
  at: number;
}

/**
 * A round with its ledger: when it was banked, how often it has been dealt,
 * and what the players made of it. What the admin reads, and deliberately
 * not what `draw` returns — the game has no use for the numbers, and
 * `NewBankedRound` is derived from `BankedRound`, so putting them there would
 * make every insert carry a served count it does not own.
 */
export interface BankedRoundRecord extends BankedRound {
  createdAt: number;
  timesServed: number;
  lastServedAt: number | null;
  votes: RoundVoteTally;
}

/**
 * Which rounds to list. Every field narrows; none is required. `language`
 * and `missingLanguage` are the two ends of the same question — what could a
 * German lobby be dealt, and what could it not — and the second is the
 * backfill queue the catalogue's Open Questions describe, made visible.
 */
export interface RoundFilter {
  topic?: TopicId;
  kind?: RoundKind;
  /** Only rounds written in this language. */
  language?: LanguageId;
  /** Only rounds *not* written in this language. */
  missingLanguage?: LanguageId;
  /** Case-insensitive, anywhere in the subject or in any language's answer. */
  search?: string;
}

export interface RoundPage {
  /** Newest first. */
  rounds: BankedRoundRecord[];
  /** How many match the filter in all, so a page can say where it is. */
  total: number;
}

/**
 * An edit. Every field is optional and only the named ones change; `texts`
 * is per language, and a language set to `null` is removed from the round.
 * `kind` is not here on purpose — a picture cannot become a paraphrase, and a
 * round that has to change kind is a round to delete and refill.
 */
export interface RoundPatch {
  topic?: TopicId;
  subject?: string;
  imageFile?: string | null;
  sourceUrl?: string | null;
  snippet?: string | null;
  snippetLanguage?: string | null;
  texts?: Partial<Record<LanguageId, BankedRoundText | null>>;
}

/**
 * Why an edit did not land, named so the editor can say so. `duplicate`
 * quotes the round in the way: the topic already answers to this word in
 * this language, and the same rule that stops the fill tool banking it twice
 * stops an edit from making it so.
 */
export type RoundUpdateResult =
  | { ok: true }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "no_texts" }
  | { ok: false; reason: "duplicate"; language: LanguageId; answer: string; roundId: number };

/** One topic's shelf: how many rounds it holds, and how many each language could be dealt. */
export interface TopicStock {
  topic: TopicId;
  /** Every round on the shelf, whatever languages it was written in. */
  rounds: number;
  /** Per language, the rounds a lobby in it could actually be dealt. */
  counts: Partial<Record<LanguageId, number>>;
}

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
  /**
   * Every alias banked for a topic, in every language — the half of the
   * exclusion a generator is *checked* against but never shown. Ten aliases
   * per language per round would drown the answers in the prompt, and the
   * model does not need "United States" spelled out to be refused for it once
   * the duplicate check knows a round already answers to that name.
   */
  aliases(topic: TopicId): Promise<string[]>;
  /**
   * Writes one player's verdict on a round down. The one thing the game
   * writes to the bank besides the draw's own served count — and, like that,
   * it is fire-and-forget from the game's side: the player has already been
   * acked, and a vote that could not be written is a line in the log, not a
   * round that failed. A vote on a round that has since been deleted is
   * refused by the foreign key and surfaces as a rejection here; the caller
   * treats it the same way.
   */
  recordVote(vote: NewRoundVote): Promise<void>;

  // The admin's half: reading the shelf as a shelf, and changing what is on
  // it. The game never calls any of these — it draws and votes, and nothing
  // else.

  /** A page of rounds, newest first, narrowed by `filter`. */
  list(filter: RoundFilter, page: { offset: number; limit: number }): Promise<RoundPage>;
  /** One round with every language it holds, or null. */
  get(id: number): Promise<BankedRoundRecord | null>;
  /**
   * Applies a patch. Refused whole — nothing written — when it would leave
   * the round with no language at all, or when a changed answer is one the
   * topic already holds in that language on another round. Moving a round to
   * a new topic re-checks every language against the new shelf.
   */
  update(id: number, patch: RoundPatch): Promise<RoundUpdateResult>;
  /**
   * Removes a round and its texts, and hands back what was removed so the
   * caller can tidy up after it — the picture, if nothing else still points
   * at it (see `imageReferences`). Null when there was nothing to remove.
   */
  delete(id: number): Promise<BankedRoundRecord | null>;
  /**
   * `delete`, for several at once: every round named that is still there
   * goes in one transaction, and what was removed comes back — newest first
   * — for the same tidying. A round already gone is simply not in the list
   * rather than a reason to stop, and an empty list removes nothing.
   */
  deleteMany(ids: readonly number[]): Promise<BankedRoundRecord[]>;
  /**
   * How many rounds show this picture. Content addressing means two rounds
   * with the same bytes share one object, so a round's deletion may only
   * take the picture with it when this says nobody else is looking at it.
   */
  imageReferences(imageFile: string): Promise<number>;
  /**
   * Every topic's shelf at once, in catalogue order — what the fill tool
   * gauges topic by topic, read in two queries rather than one per cell.
   * A topic the catalogue no longer names but the bank still holds is listed
   * after the catalogue: rounds nobody can be dealt are exactly what an
   * operator needs to see.
   */
  stock(): Promise<TopicStock[]>;

  close(): Promise<void>;
}

/**
 * How answers are compared for deduplication and exclusion. Deliberately
 * simpler than the guess matching in `lobby/matching.ts`: this decides whether
 * two *rounds* are the same round, not whether a player was close enough.
 */
export const answerKey = (answer: string): string => answer.trim().toLowerCase();
