/**
 * Does this guess count?
 *
 * Two layers, and they answer different complaints. Normalising handles the
 * ways a player can be *right* while typing something that is not
 * character-for-character the answer — capitals, accents, German's ß,
 * punctuation, a leading "the", a double space. Edit distance handles the way a player can be
 * right and still miss the keys, which under a twenty second clock is most of
 * them.
 *
 * The distance budget is scaled by the length of what is being matched against,
 * and short answers get nothing at all. "Mali" and "Bali" are one edit apart
 * and are two different countries; a game that hands out points for the wrong
 * one is worse than a game that asks you to type carefully.
 *
 * The tiers are set by where the collisions actually are rather than by the
 * round numbers they look like. Two edits do not become safe at nine characters
 * — "Austria" and "Australia" are two apart, as are "Slovakia" and "Slovenia" —
 * so the second edit is held back until eleven, by which point a pair of real
 * answers that close has stopped turning up.
 *
 * Every alias the content source returned is matched the same way, which is
 * what makes "USA" land on "United States" — the list is where knowledge about
 * the subject lives, and this file only knows about typing.
 */

/** Diacritics, once NFD has split them off their letters. */
const COMBINING_MARKS = /\p{M}+/gu;

/** Everything that is not a letter or a digit collapses to one space. */
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]+/gu;

/**
 * German's one letter that is really two. NFD leaves it alone — it has no
 * decomposition — so "Fussball" would otherwise cost an edit against
 * "Fußball" and "Weisse Rose" two against "Weiße Rose", which is the whole
 * budget spent on a key half of Germany does not have.
 */
const SHARP_S = /ß/gu;

/**
 * Stripped from both sides, so "The Beatles" and "beatles" meet in the middle.
 * Only the front: "Lord of the Rings" keeps its middle "the", which is doing
 * real work there.
 */
const LEADING_ARTICLE = /^(?:the|a|an) /;

export function normalize(text: string): string {
  const folded = text
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(SHARP_S, "ss")
    // Before punctuation is stripped, or "Ben & Jerry's" and "Ben and Jerry's"
    // would normalise to two different things.
    .replace(/&/gu, " and ")
    .replace(NOT_ALPHANUMERIC, " ")
    .trim();

  return folded.replace(LEADING_ARTICLE, "");
}

/**
 * How many single-character edits a guess may be out, by the length of the
 * thing it is being compared against. See the note at the top of the file for
 * why the short bucket is zero.
 */
function budgetFor(length: number): number {
  if (length <= 4) return 0;
  if (length <= 10) return 1;
  return 2;
}

/**
 * Levenshtein distance, asked only whether it stays under a budget rather than
 * what it is. That question is much cheaper: a row whose every cell already
 * exceeds the budget cannot lead anywhere under it, so the whole rest of the
 * table is skipped.
 */
function withinDistance(a: string, b: string, budget: number): boolean {
  if (a === b) return true;
  if (budget <= 0) return false;
  // Insertions and deletions alone cost the length difference, so this is a
  // floor on the distance and worth checking before building any rows.
  if (Math.abs(a.length - b.length) > budget) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      const cost = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + substitution,
      );
      current.push(cost);
      if (cost < best) best = cost;
    }

    if (best > budget) return false;
    previous = current;
  }

  return previous[b.length]! <= budget;
}

/**
 * The answer and its aliases are one flat list of things that count. Order does
 * not matter — the first match wins and they all pay the same.
 */
export function matchesAnswer(
  guess: string,
  answer: string,
  aliases: readonly string[],
): boolean {
  const attempt = normalize(guess);
  if (!attempt) return false;

  for (const candidate of [answer, ...aliases]) {
    const target = normalize(candidate);
    if (!target) continue;
    if (attempt === target) return true;
    if (withinDistance(attempt, target, budgetFor(target.length))) return true;
  }

  return false;
}
