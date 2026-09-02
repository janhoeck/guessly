import { describe, expect, it } from "vitest";
import { dedupKey, findDuplicate, uniqueNames } from "./dedup.js";
import type { ParsedTexts } from "./schema.js";

/** A submission's texts, with only the names under test spelled out. */
function texts(
  en: { answer: string; aliases?: string[] },
  de?: { answer: string; aliases?: string[] },
): ParsedTexts {
  const out: ParsedTexts = {
    en: { question: "Who is this?", answer: en.answer, aliases: en.aliases ?? [] },
  };
  if (de) {
    out.de = { question: "Wer ist das?", answer: de.answer, aliases: de.aliases ?? [] };
  }
  return out;
}

describe("dedupKey", () => {
  it("folds case and accents", () => {
    expect(dedupKey("Beyoncé")).toBe(dedupKey("beyonce"));
  });

  it("folds ß to ss", () => {
    expect(dedupKey("Weiße Rose")).toBe(dedupKey("Weisse Rose"));
  });

  it("folds punctuation and a leading article", () => {
    expect(dedupKey("The Eiffel Tower!")).toBe(dedupKey("Eiffel  Tower"));
    expect(dedupKey("Das Brandenburger Tor")).toBe(dedupKey("Brandenburger Tor"));
  });

  it("reads & as and", () => {
    expect(dedupKey("Ben & Jerry's")).toBe(dedupKey("Ben and Jerry's"));
  });

  it("keeps an article that is not leading", () => {
    expect(dedupKey("Lord of the Rings")).not.toBe(dedupKey("Lord of Rings"));
  });
});

describe("findDuplicate", () => {
  it("passes a subject the shelf does not hold", () => {
    expect(findDuplicate(texts({ answer: "Japan" }), ["Bhutan", "France"], [])).toBeNull();
  });

  it("catches the same answer under another spelling", () => {
    expect(
      findDuplicate(texts({ answer: "The Eiffel Tower" }), ["Eiffel Tower"], []),
    ).toEqual({ candidate: "The Eiffel Tower", banked: "Eiffel Tower" });
  });

  it("catches an answer the shelf holds as an alias", () => {
    expect(
      findDuplicate(texts({ answer: "United States" }), ["USA"], ["United States"]),
    ).toEqual({ candidate: "United States", banked: "United States" });
  });

  it("catches an alias the shelf holds as an answer", () => {
    expect(
      findDuplicate(texts({ answer: "USA", aliases: ["United States"] }), ["United States"], []),
    ).toEqual({ candidate: "United States", banked: "United States" });
  });

  it("catches a collision in any language of the submission", () => {
    expect(
      findDuplicate(texts({ answer: "Munich" }, { answer: "München" }), ["Muenchen"], []),
    ).toBeNull();
    expect(
      findDuplicate(texts({ answer: "Munich" }, { answer: "München" }), ["Munchen"], []),
    ).toEqual({ candidate: "München", banked: "Munchen" });
  });

  /** Song rounds alias their artist; two Queen songs are not the same round. */
  it("never matches alias against alias", () => {
    expect(
      findDuplicate(
        texts({ answer: "Don't Stop Me Now", aliases: ["Queen"] }),
        ["Bohemian Rhapsody"],
        ["Queen"],
      ),
    ).toBeNull();
  });
});

describe("uniqueNames", () => {
  it("lists a name several languages spell alike once, keeping the first spelling", () => {
    expect(uniqueNames(["Bhutan", "Bhutan", "The Eiffel Tower", "Eiffel  Tower"])).toEqual([
      "Bhutan",
      "The Eiffel Tower",
    ]);
  });

  it("keeps names the languages genuinely translate", () => {
    expect(uniqueNames(["Germany", "Deutschland"])).toEqual(["Germany", "Deutschland"]);
  });

  it("drops what folds away to nothing", () => {
    expect(uniqueNames(["!!!", ""])).toEqual([]);
  });
});
