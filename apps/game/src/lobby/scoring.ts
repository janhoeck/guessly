import {
  ROUND_DURATION_MS,
  ROUND_MAX_POINTS,
  ROUND_MIN_POINTS,
} from "@guessly/protocol";

/**
 * Time to points, in a straight line.
 *
 * The curve is deliberately shallow and deliberately floored. Shallow, because
 * a party game where the first two seconds decide everything is a game the
 * slowest player stops playing; floored, because a correct answer on the buzzer
 * is still a correct answer, and scoring it zero would make the last ten
 * seconds of every round worthless to everybody who was not first.
 *
 * Elapsed time is clamped at both ends. A guess cannot arrive before the round
 * opens, and one that arrives a millisecond after the deadline — the reveal
 * timer is a timer, not a guarantee — is worth the minimum rather than a
 * negative number.
 */
export function pointsFor(elapsedMs: number): number {
  const elapsed = Math.min(Math.max(elapsedMs, 0), ROUND_DURATION_MS);
  const remaining = 1 - elapsed / ROUND_DURATION_MS;
  return ROUND_MIN_POINTS + Math.round((ROUND_MAX_POINTS - ROUND_MIN_POINTS) * remaining);
}
