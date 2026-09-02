import type { ParsedTexts } from "./schema.js";

/**
 * Is this submission a round the bank already holds?
 *
 * The schema cannot ask this and the prompt can only request it: the exclusion
 * list rides in the user message, and a model that picks "United States" when
 * the list says "USA", or "The Eiffel Tower" when it says "Eiffel Tower", has
 * followed the letter of the instruction. This is the check that enforces the
 * spirit — run before the image is searched for, downloaded and stored, and
 * returning the collision by name so the retry can quote it instead of
 * re-rolling the same subject.
 *
 * Two names are the same name once folded the way `lobby/matching.ts` folds a
 * guess — case, accents, ß, punctuation, "&", a leading article — minus the
 * edit-distance budget: that budget decides whether a *player* was close
 * enough, this decides whether two *rounds* are the same round, and "Mali"
 * one key away from "Bali" is two different rounds.
 *
 * What is compared against what is deliberately asymmetric. The candidate's
 * answers are checked against the banked answers *and* their aliases, and the
 * candidate's aliases against the banked answers — but never alias against
 * alias, because a song round aliases its artist, and two Queen songs sharing
 * "Queen" in their lists are not the same round.
 */

/** Diacritics, once NFD has split them off their letters. */
const COMBINING_MARKS = /\p{M}+/gu;

/** Everything that is not a letter or a digit collapses to one space. */
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/** German's one letter that is really two; NFD leaves it alone. */
const SHARP_S = /ß/gu;

/**
 * English and German, because those are the catalogue's languages; a new
 * language whose articles are worth folding adds them here. Only the front,
 * as in matching.ts: the "the" inside "Lord of the Rings" is doing real work.
 */
const LEADING_ARTICLE = /^(?:the|a|an|der|die|das|ein|eine) /;

/** One name reduced to what identifies it, for equality and nothing subtler. */
export function dedupKey(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(SHARP_S, "ss")
    // Before punctuation is stripped, or "Ben & Jerry's" and "Ben and
    // Jerry's" would fold to two different things.
    .replace(/&/gu, " and ")
    .replace(NOT_ALPHANUMERIC, " ")
    .trim();

  return folded.replace(LEADING_ARTICLE, "");
}

/** A collision, named from both ends so the retry note can quote it. */
export interface DuplicateMatch {
  /** What the submission called it... */
  candidate: string;
  /** ...and the name already on the shelf that it collides with. */
  banked: string;
}

export function findDuplicate(
  texts: ParsedTexts,
  bankedAnswers: readonly string[],
  bankedAliases: readonly string[],
): DuplicateMatch | null {
  // Aliases first so that a name banked as both reports the answer, which is
  // the string the model was actually shown on the off-limits list.
  const namesByKey = new Map<string, string>();
  for (const alias of bankedAliases) {
    const key = dedupKey(alias);
    if (key !== "") namesByKey.set(key, alias);
  }
  const answersByKey = new Map<string, string>();
  for (const answer of bankedAnswers) {
    const key = dedupKey(answer);
    if (key === "") continue;
    namesByKey.set(key, answer);
    answersByKey.set(key, answer);
  }

  for (const text of Object.values(texts)) {
    if (text === undefined) continue;
    const banked = namesByKey.get(dedupKey(text.answer));
    if (banked !== undefined) return { candidate: text.answer, banked };

    for (const alias of text.aliases) {
      const bankedAnswer = answersByKey.get(dedupKey(alias));
      if (bankedAnswer !== undefined) return { candidate: alias, banked: bankedAnswer };
    }
  }
  return null;
}

/**
 * The exclusion list as the prompt shows it: every name once, however many
 * languages spell it the same. Most answers are names and names are not
 * translated, so folding by `dedupKey` roughly divides the list by the
 * language count — and what it can never do is hide a collision, because
 * `findDuplicate` folds the same way. Keeps the first spelling of each.
 */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = dedupKey(name);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
