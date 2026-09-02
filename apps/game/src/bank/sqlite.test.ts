import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NewBankedRound, RoundRepository } from "./repository.js";
import { createSqliteRoundRepository } from "./sqlite.js";

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
      en: {
        question: "Which country's flag is this?",
        answer: "Bhutan",
        aliases: ["Kingdom of Bhutan"],
      },
      de: {
        question: "Welches Land hat diese Flagge?",
        answer: "Bhutan",
        aliases: ["Königreich Bhutan"],
      },
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
    texts: {
      en: { question: "Which country's flag is this?", answer, aliases: [] },
    },
    ...overrides,
  });
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
  it("banks a round and hands back every language it was written in", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);

    const drawn = await repo.draw("flags", "en", [], NOON);
    expect(drawn).toMatchObject({
      topic: "flags",
      kind: "image",
      subject: "Flag of Bhutan",
      imageFile: `${"a".repeat(64)}.png`,
      sourceUrl: "https://example.test/flag.png",
    });
    expect(drawn?.texts.en).toEqual({
      question: "Which country's flag is this?",
      answer: "Bhutan",
      aliases: ["Kingdom of Bhutan"],
    });
    expect(drawn?.texts.de?.question).toBe("Welches Land hat diese Flagge?");
  });

  it("refuses a subject the topic already answers to, whatever the case", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);
    expect(await repo.insert(named("  BHUTAN ", "Bhutan"), NOON, false)).toBe(false);
    expect(await repo.count("flags", "en")).toBe(1);
  });

  /**
   * The clash is in one language and the round is refused whole. Banking the
   * half that fits would leave a round only some lobbies could ever be dealt,
   * looking perfectly healthy on the shelf.
   */
  it("refuses a round that clashes in only one of its languages", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    expect(await repo.insert(named("Gaul", "Frankreich"), NOON, false)).toBe(false);
    expect(await repo.count("flags", "en")).toBe(1);
    expect(await repo.count("flags", "de")).toBe(1);
  });

  it("keeps the same answer apart across topics", async () => {
    expect(await repo.insert(round(), NOON, false)).toBe(true);
    expect(await repo.insert(round({ topic: "landmarks" }), NOON, false)).toBe(true);
  });

  /**
   * One paraphrase, in the song's language, on the round rather than in its
   * texts. Every room reads the same lines and only the question follows them.
   */
  it("banks a lyrics round with one paraphrase for every language", async () => {
    await repo.insert(
      round({
        topic: "music",
        kind: "lyrics",
        subject: "Bohemian Rhapsody",
        imageFile: null,
        sourceUrl: null,
        snippetLanguage: "en",
        snippet: "Is any of this real,\nor did I make it up?",
        texts: {
          en: {
            question: "Which song is this?",
            answer: "Bohemian Rhapsody",
            aliases: ["Queen"],
          },
          de: {
            question: "Welcher Song ist das?",
            answer: "Bohemian Rhapsody",
            aliases: ["Queen"],
          },
        },
      }),
      NOON,
      false,
    );

    const drawn = await repo.draw("music", "de", [], NOON);
    expect(drawn?.kind).toBe("lyrics");
    // The German room reads the English song in English, and is asked in German.
    expect(drawn?.snippet).toContain("did I make it up");
    expect(drawn?.snippetLanguage).toBe("en");
    expect(drawn?.texts.de?.question).toBe("Welcher Song ist das?");
    expect(drawn?.imageFile).toBeNull();
  });
});

describe("draw", () => {
  it("returns null for a topic with nothing banked", async () => {
    expect(await repo.draw("flags", "en", [], NOON)).toBeNull();
  });

  it("excludes a game's used answers, case-insensitively", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    expect(await repo.draw("flags", "en", ["france"], NOON)).toBeNull();
    // A German game's used list is in German, and that is what it excludes.
    expect(await repo.draw("flags", "de", ["frankreich"], NOON)).toBeNull();
  });

  /**
   * A round written before a language existed is one its lobbies cannot be
   * shown — no question to print, no answer to score. It has to be passed over
   * inside the query rather than drawn and discarded, which would deal the
   * topic's rotation to nobody.
   */
  it("passes over a round that was never written in the language asked for", async () => {
    await repo.insert(englishOnly("France"), NOON, false);

    expect(await repo.draw("flags", "de", [], NOON)).toBeNull();
    expect((await repo.draw("flags", "en", [], NOON))?.texts.en?.answer).toBe("France");
  });

  it("prefers the round that has been served least", async () => {
    await repo.insert(named("Bhutan", "Bhutan"), NOON, false);
    expect((await repo.draw("flags", "en", [], NOON))?.subject).toBe("Bhutan");

    // Bhutan has now been dealt once; a fresh round goes out first.
    await repo.insert(named("Japan", "Japan"), NOON, false);
    expect((await repo.draw("flags", "en", [], NOON))?.subject).toBe("Japan");
  });

  /**
   * One rotation for the round, not one per language: it is the same round, so
   * dealing it to an English lobby is what sends the German one the other.
   * Which of the two goes first is `RANDOM()`'s business — they are tied — and
   * the rule is that the second draw does not repeat it.
   */
  it("counts a draw in one language against the round in every language", async () => {
    await repo.insert(named("Bhutan", "Bhutan"), NOON, false);
    await repo.insert(named("Japan", "Japan"), NOON, false);

    const english = await repo.draw("flags", "en", [], NOON);
    const german = await repo.draw("flags", "de", [], NOON);

    expect(english?.subject).toBeDefined();
    expect(german?.subject).not.toBe(english?.subject);
  });

  it("counts a round served on its way in as already dealt", async () => {
    await repo.insert(named("Bhutan", "Bhutan"), NOON, true);
    await repo.insert(named("Japan", "Japan"), NOON, false);
    expect((await repo.draw("flags", "en", [], NOON))?.subject).toBe("Japan");
  });
});

/**
 * The one migration this file has, driven against a real database file because
 * `:memory:` cannot be closed and reopened — and reopening is the whole event.
 *
 * What is being protected is somebody's existing bank: the pictures in it were
 * downloaded once and paid for once, and a schema change that silently orphaned
 * them would be a worse bug than the one it fixed.
 */
describe("a bank from before a round had languages", () => {
  /** The schema exactly as it stood, indexes and all. */
  const OLD_SCHEMA = `
    CREATE TABLE rounds (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      topic          TEXT    NOT NULL,
      kind           TEXT    NOT NULL,
      question       TEXT    NOT NULL,
      answer         TEXT    NOT NULL,
      answer_key     TEXT    NOT NULL,
      aliases        TEXT    NOT NULL,
      subject        TEXT    NOT NULL,
      snippet        TEXT,
      image_file     TEXT,
      source_url     TEXT,
      created_at     INTEGER NOT NULL,
      times_served   INTEGER NOT NULL DEFAULT 0,
      last_served_at INTEGER
    );
    CREATE UNIQUE INDEX rounds_topic_answer ON rounds (topic, answer_key);
    CREATE INDEX rounds_topic ON rounds (topic);
  `;

  let dir: string;
  let path: string;
  let migrated: RoundRepository;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "guessly-bank-"));
    path = join(dir, "rounds.db");

    const old = new DatabaseSync(path);
    old.exec(OLD_SCHEMA);
    old
      .prepare(
        `INSERT INTO rounds
           (topic, kind, question, answer, answer_key, aliases, subject,
            snippet, image_file, source_url, created_at)
         VALUES ('flags', 'image', 'Which country''s flag is this?', 'Bhutan',
                 'bhutan', '["Kingdom of Bhutan"]', 'Flag of Bhutan', NULL, ?, NULL, ?)`,
      )
      .run(`${"a".repeat(64)}.png`, NOON);
    // A lyrics round too: its paraphrase was already on the round back then,
    // and it has to stay there rather than being scattered into round_texts.
    old
      .prepare(
        `INSERT INTO rounds
           (topic, kind, question, answer, answer_key, aliases, subject,
            snippet, image_file, source_url, created_at)
         VALUES ('music', 'lyrics', 'Which song is this?', 'Bohemian Rhapsody',
                 'bohemian rhapsody', '["Queen"]', 'Bohemian Rhapsody',
                 'Is any of this real', NULL, NULL, ?)`,
      )
      .run(NOON);
    old.close();

    migrated = createSqliteRoundRepository(path);
    await migrated.init();
  });

  afterEach(async () => {
    await migrated.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps what was already banked, as English", async () => {
    expect(await migrated.count("flags", "en")).toBe(1);

    const drawn = await migrated.draw("flags", "en", [], NOON);
    expect(drawn?.subject).toBe("Flag of Bhutan");
    expect(drawn?.imageFile).toBe(`${"a".repeat(64)}.png`);
    expect(drawn?.texts.en).toMatchObject({
      question: "Which country's flag is this?",
      answer: "Bhutan",
      aliases: ["Kingdom of Bhutan"],
    });
  });

  it("keeps a lyrics round's paraphrase on the round", async () => {
    const drawn = await migrated.draw("music", "en", [], NOON);
    expect(drawn?.snippet).toBe("Is any of this real");
    // Never recorded back then, and a guess would be worse than nothing.
    expect(drawn?.snippetLanguage).toBeNull();
  });

  it("does not hand those rounds to a lobby playing in a language they lack", async () => {
    expect(await migrated.count("flags", "de")).toBe(0);
    expect(await migrated.draw("flags", "de", [], NOON)).toBeNull();
  });

  it("goes on banking new rounds beside them", async () => {
    expect(await migrated.insert(named("France", "Frankreich"), NOON, false)).toBe(true);
    expect(await migrated.count("flags", "en")).toBe(2);
    expect(await migrated.count("flags", "de")).toBe(1);
  });

  it("leaves a database it has already moved alone", async () => {
    await migrated.close();
    // Reopening runs the migration a second time, against the new shape.
    migrated = createSqliteRoundRepository(path);
    await migrated.init();
    expect(await migrated.count("flags", "en")).toBe(1);
  });
});

describe("count and answers", () => {
  it("gauges a topic in the language that will be dealt from it", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    await repo.insert(englishOnly("Japan"), NOON, false);
    await repo.insert(named("Eiffel Tower", "Eiffelturm", { topic: "landmarks" }), NOON, false);

    expect(await repo.count("flags", "en")).toBe(2);
    expect(await repo.count("flags", "de")).toBe(1);
    expect(await repo.count("music", "en")).toBe(0);
  });

  /** The exclusion list spans languages: a subject is held whichever it is in. */
  it("lists every answer a topic holds, in every language", async () => {
    await repo.insert(named("France", "Frankreich"), NOON, false);
    // Round, then language: deterministic, which is all the prompt needs.
    expect(await repo.answers("flags")).toEqual(["Frankreich", "France"]);
    expect(await repo.answers("music")).toEqual([]);
  });
});
