import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ALL_TOPIC_IDS } from "@guessly/protocol";
import { createInMemoryRoundRepository } from "./memory.js";
import type { NewBankedRound, RoundRepository } from "./repository.js";

/**
 * The admin's half of the repository: reading the shelf as a shelf and
 * changing what is on it. Argued here, against the same PGlite as
 * `postgres.test.ts`, because the rules — an edit cannot make a duplicate, a
 * round cannot be left with no language, a shared picture is nobody's to
 * delete — are the bank's own and not the admin's.
 */

const NOON = 1_700_000_000_000;

/** A banked image round in both languages, with only the field under test varied. */
function round(overrides: Partial<NewBankedRound> = {}): NewBankedRound {
  return {
    topic: "flags",
    kind: "image",
    subject: "Flag of Bhutan",
    imageFile: `${"a".repeat(64)}.png`,
    sourceUrl: "https://example.test/flag.png",
    snippet: null,
    snippetLanguage: null,
    texts: {
      en: { question: "Which country's flag is this?", answer: "Bhutan", aliases: ["Kingdom of Bhutan"] },
      de: { question: "Welches Land hat diese Flagge?", answer: "Bhutan", aliases: ["Königreich Bhutan"] },
    },
    ...overrides,
  };
}

/** The same round with a different answer per language, which is the usual case. */
function named(en: string, de: string, overrides: Partial<NewBankedRound> = {}): NewBankedRound {
  return round({
    subject: en,
    texts: {
      en: { question: "Which country's flag is this?", answer: en, aliases: [] },
      de: { question: "Welches Land hat diese Flagge?", answer: de, aliases: [] },
    },
    ...overrides,
  });
}

/** The same round written in English only — a round from before German existed. */
function englishOnly(answer: string, overrides: Partial<NewBankedRound> = {}): NewBankedRound {
  return round({
    subject: answer,
    texts: { en: { question: "Which country's flag is this?", answer, aliases: [] } },
    ...overrides,
  });
}

let repo: RoundRepository;

const all = { offset: 0, limit: 10 };

const idOf = async (subject: string): Promise<number> => {
  const { rounds } = await repo.list({ search: subject }, { offset: 0, limit: 1 });
  const found = rounds[0];
  if (found === undefined) throw new Error(`no round for ${subject}`);
  return found.id;
};

beforeEach(async () => {
  repo = createInMemoryRoundRepository();
  await repo.init();
});

afterEach(async () => {
  await repo.close();
});

describe("list and get", () => {
  it("pages newest first and says how many there are in all", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Japan", "Japan"), NOON + 1, false);
    await repo.insert(named("Bhutan", "Bhutan"), NOON + 2, false);

    const first = await repo.list({}, { offset: 0, limit: 2 });
    expect(first.total).toBe(3);
    expect(first.rounds.map((r) => r.subject)).toEqual(["Bhutan", "Japan"]);
    expect(first.rounds[0]?.texts.de?.answer).toBe("Bhutan");
    expect(first.rounds[0]).toMatchObject({ createdAt: NOON + 2, timesServed: 0, lastServedAt: null });

    const second = await repo.list({}, { offset: 2, limit: 2 });
    expect(second.rounds.map((r) => r.subject)).toEqual(["France"]);
  });

  it("narrows by topic and by kind", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Eiffel Tower", "Eiffelturm", { topic: "landmarks" }), NOON, false);
    await repo.insert(
      round({ topic: "music", kind: "lyrics", subject: "Song", imageFile: null, snippet: "la la" }),
      NOON,
      false,
    );

    expect((await repo.list({ topic: "landmarks" }, all)).total).toBe(1);
    expect((await repo.list({ kind: "lyrics" }, all)).rounds[0]?.subject).toBe("Song");
    expect((await repo.list({ kind: "image" }, all)).total).toBe(2);
  });

  /** The two ends of one question: what a German lobby could be dealt, and what it could not. */
  it("narrows to the rounds written in a language, or missing it", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(englishOnly("Japan"), NOON, false);

    const german = await repo.list({ language: "de" }, all);
    expect(german.rounds.map((r) => r.subject)).toEqual(["France"]);

    const backfill = await repo.list({ missingLanguage: "de" }, all);
    expect(backfill.rounds.map((r) => r.subject)).toEqual(["Japan"]);
  });

  it("searches the subject and every language's answer, case-insensitively", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Japan", "Japan", { subject: "Flag of Japan" }), NOON, false);

    expect((await repo.list({ search: "frankr" }, all)).rounds.map((r) => r.subject)).toEqual(["France"]);
    expect((await repo.list({ search: "FLAG OF" }, all)).rounds.map((r) => r.subject)).toEqual([
      "Flag of Japan",
    ]);
    expect((await repo.list({ search: "nowhere" }, all)).total).toBe(0);
  });

  /** LIKE's own wildcards are text here, not syntax. */
  it("takes a search term literally", async () => {
    await repo.insert(named("100% Cotton", "100% Baumwolle", { topic: "logos" }), NOON, false);
    await repo.insert(named("100 Cotton", "100 Baumwolle", { topic: "logos" }), NOON, false);

    expect((await repo.list({ search: "100%" }, all)).rounds.map((r) => r.subject)).toEqual(["100% Cotton"]);
    expect((await repo.list({ search: "_" }, all)).total).toBe(0);
  });

  it("gets one round with its ledger, or null", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const id = await idOf("France");
    await repo.draw("flags", "en", [], NOON + 5);

    const got = await repo.get(id);
    expect(got).toMatchObject({ subject: "France", timesServed: 1, lastServedAt: NOON + 5 });
    expect(got?.texts.de?.answer).toBe("Frankreich");
    expect(await repo.get(id + 1000)).toBeNull();
  });
});

describe("update", () => {
  it("changes only what the patch names", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const id = await idOf("France");

    expect(
      await repo.update(id, {
        subject: "Tricolore",
        texts: { de: { question: "Welche Flagge?", answer: "Frankreich", aliases: ["Republik"] } },
      }),
    ).toEqual({ ok: true });

    const after = await repo.get(id);
    expect(after?.subject).toBe("Tricolore");
    expect(after?.topic).toBe("flags");
    expect(after?.texts.en?.answer).toBe("France");
    expect(after?.texts.de).toEqual({ question: "Welche Flagge?", answer: "Frankreich", aliases: ["Republik"] });
  });

  it("adds a language the round was never written in, which is then dealt to it", async () => {
    await repo.insert(englishOnly("Japan"), NOON, false);
    const id = await idOf("Japan");
    expect(await repo.draw("flags", "de", [], NOON)).toBeNull();

    await repo.update(id, { texts: { de: { question: "Welches Land?", answer: "Japan", aliases: [] } } });
    expect((await repo.draw("flags", "de", [], NOON))?.id).toBe(id);
  });

  it("removes a language set to null, but never the last one", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const id = await idOf("France");

    expect(await repo.update(id, { texts: { de: null } })).toEqual({ ok: true });
    expect((await repo.get(id))?.texts.de).toBeUndefined();
    expect(await repo.count("flags", "de")).toBe(0);

    expect(await repo.update(id, { texts: { en: null } })).toEqual({ ok: false, reason: "no_texts" });
    expect((await repo.get(id))?.texts.en?.answer).toBe("France");
  });

  /** The rule `insert` enforces, enforced on the way an edit could break it. */
  it("refuses an answer another round on the shelf already gives, and names it", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Japan", "Japan"), NOON, false);
    const japan = await idOf("Japan");
    const france = await idOf("France");

    expect(
      await repo.update(japan, {
        subject: "Not Japan",
        texts: { en: { question: "Which flag?", answer: " FRANCE ", aliases: [] } },
      }),
    ).toEqual({ ok: false, reason: "duplicate", language: "en", answer: "France", roundId: france });
    // Refused whole: nothing else in the patch landed either.
    expect(await repo.get(japan)).toMatchObject({ subject: "Japan" });
    expect((await repo.get(japan))?.texts.en?.answer).toBe("Japan");
  });

  it("re-checks every language when a round moves to another shelf", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("France", "Frankreich", { topic: "landmarks" }), NOON, false);
    const moving = (await repo.list({ topic: "landmarks" }, all)).rounds[0]!;

    expect(await repo.update(moving.id, { topic: "flags" })).toMatchObject({ ok: false, reason: "duplicate" });
    expect((await repo.get(moving.id))?.topic).toBe("landmarks");

    expect(await repo.update(moving.id, { topic: "logos" })).toEqual({ ok: true });
    expect(await repo.count("logos", "de")).toBe(1);
  });

  it("does not refuse an edit for an answer the round itself already gives", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const id = await idOf("France");
    expect(
      await repo.update(id, {
        texts: { en: { question: "Whose flag is this?", answer: "France", aliases: ["FR"] } },
      }),
    ).toEqual({ ok: true });
    expect((await repo.get(id))?.texts.en?.aliases).toEqual(["FR"]);
  });

  it("is a not_found for a round that is not there", async () => {
    expect(await repo.update(404, { subject: "x" })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("delete and imageReferences", () => {
  it("removes the round and its texts, and hands back what it removed", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const id = await idOf("France");

    const gone = await repo.delete(id);
    expect(gone?.subject).toBe("France");
    expect(gone?.texts.de?.answer).toBe("Frankreich");
    expect(await repo.get(id)).toBeNull();
    expect(await repo.count("flags", "en")).toBe(0);
    expect(await repo.answers("flags")).toEqual([]);
    expect(await repo.delete(id)).toBeNull();
  });

  /** One call however many were ticked, and only what was there comes back. */
  it("removes several at once and hands back the ones that were there, newest first", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Japan", "Japan"), NOON + 1, false);
    await repo.insert(named("Bhutan", "Bhutan"), NOON + 2, false);
    const france = await idOf("France");
    const japan = await idOf("Japan");

    const gone = await repo.deleteMany([france, japan, france + 1000]);
    expect(gone.map((r) => r.subject)).toEqual(["Japan", "France"]);
    expect(gone[1]?.texts.de?.answer).toBe("Frankreich");
    expect(await repo.get(france)).toBeNull();
    expect(await repo.get(japan)).toBeNull();
    expect((await repo.list({}, all)).rounds.map((r) => r.subject)).toEqual(["Bhutan"]);
    expect(await repo.answers("flags")).toEqual(["Bhutan", "Bhutan"]);

    expect(await repo.deleteMany([japan])).toEqual([]);
    expect(await repo.deleteMany([])).toEqual([]);
    expect((await repo.list({}, all)).total).toBe(1);
  });

  /** Two rounds, one picture: the picture outlives the first deletion. */
  it("counts how many rounds still show a picture", async () => {
    const shared = `${"b".repeat(64)}.png`;
    await repo.insert(named("France", "Frankreich", { imageFile: shared }), NOON, false);
    await repo.insert(named("Japan", "Japan", { imageFile: shared }), NOON, false);
    await repo.insert(named("Bhutan", "Bhutan"), NOON, false);
    expect(await repo.imageReferences(shared)).toBe(2);

    await repo.delete(await idOf("Japan"));
    expect(await repo.imageReferences(shared)).toBe(1);
    expect(await repo.imageReferences(`${"c".repeat(64)}.png`)).toBe(0);
  });
});

describe("votes", () => {
  it("counts the thumbs per round, and reads zero for a round nobody has judged", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(named("Japan", "Japan"), NOON + 1, false);
    const france = await idOf("France");
    const japan = await idOf("Japan");

    await repo.recordVote({ roundId: france, language: "en", vote: "up", at: NOON + 10 });
    await repo.recordVote({ roundId: france, language: "de", vote: "up", at: NOON + 11 });
    await repo.recordVote({ roundId: france, language: "en", vote: "down", at: NOON + 12 });

    expect((await repo.get(france))?.votes).toEqual({ up: 2, down: 1 });
    expect((await repo.get(japan))?.votes).toEqual({ up: 0, down: 0 });
    expect((await repo.list({}, all)).rounds.map((r) => [r.subject, r.votes])).toEqual([
      ["Japan", { up: 0, down: 0 }],
      ["France", { up: 2, down: 1 }],
    ]);
  });

  it("refuses a vote on a round that is not there", async () => {
    await expect(
      repo.recordVote({ roundId: 404, language: "en", vote: "up", at: NOON }),
    ).rejects.toThrow();
  });

  /**
   * The votes go with the round. If they did not, the foreign key would
   * refuse the deletion — so a deletion that succeeds with votes on the
   * round is the cascade working, and the record handed back still says
   * how the round was received.
   */
  it("takes a deleted round's votes with it", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    const france = await idOf("France");
    await repo.recordVote({ roundId: france, language: "en", vote: "down", at: NOON });

    const gone = await repo.delete(france);

    expect(gone?.votes).toEqual({ up: 0, down: 1 });
    expect(await repo.get(france)).toBeNull();
  });
});

describe("stock", () => {
  it("lists every catalogue topic, empty or not, in catalogue order", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(englishOnly("Japan"), NOON, false);
    await repo.insert(named("Eiffel Tower", "Eiffelturm", { topic: "landmarks" }), NOON, false);

    const stock = await repo.stock();
    expect(stock.map((shelf) => shelf.topic)).toEqual([...ALL_TOPIC_IDS]);
    expect(stock.find((shelf) => shelf.topic === "flags")).toEqual({
      topic: "flags",
      rounds: 2,
      counts: { en: 2, de: 1 },
    });
    expect(stock.find((shelf) => shelf.topic === "landmarks")?.counts).toEqual({ en: 1, de: 1 });
    expect(stock.find((shelf) => shelf.topic === "music")).toEqual({ topic: "music", rounds: 0, counts: {} });
  });
});
