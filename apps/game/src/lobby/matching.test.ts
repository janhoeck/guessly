import { describe, expect, it } from "vitest";
import { matchesAnswer, normalize } from "./matching.js";

/** Most cases only care about the answer, so the alias list is usually empty. */
const accepts = (guess: string, answer: string, aliases: string[] = []): boolean =>
  matchesAnswer(guess, answer, aliases);

describe("normalize", () => {
  it.each([
    ["case", "BHUTAN", "bhutan"],
    ["accents", "Köln", "koln"],
    ["the sharp s", "Weiße Rose", "weisse rose"],
    ["punctuation", "Ben & Jerry's!", "ben and jerry s"],
    ["runs of whitespace", "  united   states  ", "united states"],
    ["a leading article", "The Beatles", "beatles"],
  ])("folds away %s", (_label, input, expected) => {
    expect(normalize(input)).toBe(expected);
  });

  it("keeps an article that is doing work in the middle", () => {
    expect(normalize("The Lord of the Rings")).toBe("lord of the rings");
  });

  it("comes back empty when there was nothing but punctuation", () => {
    expect(normalize("!!! ???")).toBe("");
  });
});

describe("matchesAnswer", () => {
  it("accepts the answer typed exactly", () => {
    expect(accepts("Bhutan", "Bhutan")).toBe(true);
  });

  it.each([
    ["capitals", "bhutan"],
    ["a stray space", " Bhutan "],
    ["punctuation", "Bhutan!"],
  ])("accepts an answer with %s", (_label, guess) => {
    expect(accepts(guess, "Bhutan")).toBe(true);
  });

  /**
   * A German answer typed on a keyboard with no ß, which is most keyboards
   * outside Germany and Austria and — more to the point — most phones. Folded
   * rather than left to the edit budget, which an answer with two of them would
   * spend entirely on typing that was not actually wrong.
   */
  it("accepts ss for ß without spending an edit on it", () => {
    expect(accepts("Fussball", "Fußball")).toBe(true);
    expect(accepts("Weisse Rose", "Weiße Rose")).toBe(true);
  });

  it("accepts an alias", () => {
    expect(accepts("USA", "United States", ["USA", "America"])).toBe(true);
  });

  it("accepts a guess that drops a leading article the answer had", () => {
    expect(accepts("Eiffel Tower", "The Eiffel Tower")).toBe(true);
  });

  it("accepts an accent nobody has a key for", () => {
    expect(accepts("Koln", "Köln")).toBe(true);
  });

  it("rejects a different answer", () => {
    expect(accepts("Nepal", "Bhutan")).toBe(false);
  });

  it("rejects an empty guess, and one that was only punctuation", () => {
    expect(accepts("   ", "Bhutan")).toBe(false);
    expect(accepts("???", "Bhutan")).toBe(false);
  });

  describe("typos", () => {
    it("forgives one slip in a medium answer", () => {
      expect(accepts("Bhutann", "Bhutan")).toBe(true);
      expect(accepts("Bhutn", "Bhutan")).toBe(true);
    });

    it("forgives two in a long one", () => {
      expect(accepts("Eifel Towr", "Eiffel Tower")).toBe(true);
    });

    it("forgives nothing in a short one, because the neighbours are real answers", () => {
      expect(accepts("Bali", "Mali")).toBe(false);
      expect(accepts("Chad", "Chile")).toBe(false);
    });

    it("still refuses a guess that is simply too far out", () => {
      expect(accepts("Belgium", "Bulgaria")).toBe(false);
    });

    it.each([
      ["Austria", "Australia"],
      ["Slovakia", "Slovenia"],
      ["Niger", "Nigeria"],
    ])("refuses %s for %s — two real answers two edits apart", (guess, answer) => {
      expect(accepts(guess, answer)).toBe(false);
    });

    it("measures the budget against the alias it matched, not the answer", () => {
      // "USA" is three characters and gets no slack of its own...
      expect(accepts("USB", "United States", ["USA"])).toBe(false);
      // ...while the long answer beside it still forgives a slip.
      expect(accepts("United Statse", "United States", ["USA"])).toBe(true);
    });

    it("does not let a much shorter guess sneak in on edit distance", () => {
      expect(accepts("Eiffel", "Eiffel Tower")).toBe(false);
    });
  });
});
