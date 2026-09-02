import { describe, expect, it } from "vitest";
import {
  ROUND_DURATION_MS,
  ROUND_MAX_POINTS,
  ROUND_MIN_POINTS,
} from "@guessly/protocol";
import { pointsFor } from "./scoring.js";

describe("pointsFor", () => {
  it("pays the maximum for an answer at the instant the round opens", () => {
    expect(pointsFor(0)).toBe(ROUND_MAX_POINTS);
  });

  it("pays the minimum for one on the buzzer", () => {
    expect(pointsFor(ROUND_DURATION_MS)).toBe(ROUND_MIN_POINTS);
  });

  /** The curve, written out. A change to it should have to be typed here too. */
  it.each([
    [0, 20],
    [2_000, 19],
    [5_000, 16],
    [10_000, 13],
    [15_000, 9],
    [20_000, 5],
  ])("pays %i ms with %i points", (elapsed, expected) => {
    expect(pointsFor(elapsed)).toBe(expected);
  });

  it("never pays less for being faster", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let elapsed = 0; elapsed <= ROUND_DURATION_MS; elapsed += 250) {
      const points = pointsFor(elapsed);
      expect(points).toBeLessThanOrEqual(previous);
      previous = points;
    }
  });

  it("clamps a stamp from outside the round rather than paying nonsense", () => {
    expect(pointsFor(-5_000)).toBe(ROUND_MAX_POINTS);
    expect(pointsFor(ROUND_DURATION_MS + 5_000)).toBe(ROUND_MIN_POINTS);
  });

  it("always awards something for being right", () => {
    for (let elapsed = 0; elapsed <= ROUND_DURATION_MS; elapsed += 100) {
      expect(pointsFor(elapsed)).toBeGreaterThanOrEqual(ROUND_MIN_POINTS);
    }
  });
});
