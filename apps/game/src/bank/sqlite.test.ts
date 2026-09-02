import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewBankedRound, RoundRepository } from "./repository.js";
import { createSqliteRoundRepository } from "./sqlite.js";

const NOON = 1_700_000_000_000;

/** A banked image round with only the field under test varied. */
function round(overrides: Partial<NewBankedRound> = {}): NewBankedRound {
  return {
    topic: "flags",
    kind: "image",
    question: "Which country's flag is this?",
    answer: "Bhutan",
    aliases: ["Kingdom of Bhutan"],
    subject: "Flag of Bhutan",
    snippet: null,
    imageFile: `${"a".repeat(64)}.png`,
    sourceUrl: "https://example.test/flag.png",
    ...overrides,
  };
}

let repo: RoundRepository;

beforeEach(async () => {
  repo = createSqliteRoundRepository(":memory:");
  await repo.init();
});

afterEach(async () => {
  await repo.close();
});

describe("insert", () => {
  it("banks a round and hands it back whole", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);

    const drawn = await repo.draw("flags", [], NOON);
    expect(drawn).toMatchObject({
      topic: "flags",
      kind: "image",
      question: "Which country's flag is this?",
      answer: "Bhutan",
      aliases: ["Kingdom of Bhutan"],
      subject: "Flag of Bhutan",
      snippet: null,
      imageFile: `${"a".repeat(64)}.png`,
      sourceUrl: "https://example.test/flag.png",
    });
  });

  it("refuses the same answer for the same topic, whatever the case", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);
    expect(await repo.insert(round({ answer: "  BHUTAN " }), NOON, false)).toBe(false);
    expect(await repo.count("flags")).toBe(1);
  });

  it("keeps the same answer apart across topics", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);
    expect(await repo.insert(round({ topic: "landmarks" }), NOON, false)).toBe(true);
  });

  it("banks a lyrics round with its snippet", async () => {
    await repo.insert(
      round({
        topic: "music",
        kind: "lyrics",
        answer: "Bohemian Rhapsody",
        snippet: "Is any of this real,\nor did I make it up?",
        imageFile: null,
        sourceUrl: null,
      }),
      NOON,
      false,
    );

    const drawn = await repo.draw("music", [], NOON);
    expect(drawn?.kind).toBe("lyrics");
    expect(drawn?.snippet).toBe("Is any of this real,\nor did I make it up?");
    expect(drawn?.imageFile).toBeNull();
  });
});

describe("draw", () => {
  it("returns null for a topic with nothing banked", async () => {
    expect(await repo.draw("flags", [], NOON)).toBeNull();
  });

  it("excludes a game's used answers, case-insensitively", async () => {
    await repo.insert(round(), NOON, false);
    expect(await repo.draw("flags", ["bhutan"], NOON)).toBeNull();
  });

  it("prefers the round that has been served least", async () => {
    await repo.insert(round({ answer: "Bhutan" }), NOON, false);
    expect((await repo.draw("flags", [], NOON))?.answer).toBe("Bhutan");

    // Bhutan has now been dealt once; a fresh round goes out first.
    await repo.insert(round({ answer: "Japan" }), NOON, false);
    expect((await repo.draw("flags", [], NOON))?.answer).toBe("Japan");
  });

  it("counts a round served on its way in as already dealt", async () => {
    await repo.insert(round({ answer: "Bhutan" }), NOON, true);
    await repo.insert(round({ answer: "Japan" }), NOON, false);
    expect((await repo.draw("flags", [], NOON))?.answer).toBe("Japan");
  });
});

describe("count and answers", () => {
  it("gauges one topic's shelf, not the whole bank", async () => {
    await repo.insert(round({ answer: "Bhutan" }), NOON, false);
    await repo.insert(round({ answer: "Japan" }), NOON, false);
    await repo.insert(round({ topic: "landmarks", answer: "Eiffel Tower" }), NOON, false);

    expect(await repo.count("flags")).toBe(2);
    expect(await repo.count("music")).toBe(0);
    expect(await repo.answers("flags")).toEqual(["Bhutan", "Japan"]);
  });
});
