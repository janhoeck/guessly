import { describe, expect, it } from "vitest";
import { RoundSourceError } from "../content/source.js";
import { matchesAnswer } from "../lobby/matching.js";
import type { RoundRequest } from "../lobby/store.js";
import { createSqliteRoundRepository, type NewBankedRound, type RoundRepository } from "@guessly/bank";
import { createBankedRoundSource } from "./source.js";

const NOON = 1_700_000_000_000;
const NEVER = new AbortController().signal;

function request(overrides: Partial<RoundRequest> = {}): RoundRequest {
  return {
    code: "AB2CD",
    number: 1,
    topic: "flags",
    kind: "image",
    language: "en",
    exclude: [],
    startsAt: NOON,
    ...overrides,
  };
}

/** A banked image round: the same subject named in both languages. */
function bankedImage(en: string, de = en, aliases: string[] = []): NewBankedRound {
  return {
    topic: "flags",
    kind: "image",
    subject: en,
    imageFile: `${en.toLowerCase().padEnd(64, "0").slice(0, 64)}.png`,
    sourceUrl: `https://example.test/${en.toLowerCase()}.png`,
    snippet: null,
    snippetLanguage: null,
    texts: {
      en: { question: "Which country's flag is this?", answer: en, aliases },
      de: { question: "Welches Land hat diese Flagge?", answer: de, aliases: [] },
    },
  };
}

function bankedLyrics(answer: string): NewBankedRound {
  return {
    topic: "music",
    kind: "lyrics",
    subject: answer,
    imageFile: null,
    sourceUrl: null,
    snippet: "Is any of this real,\nor did I make it up?",
    snippetLanguage: "en",
    texts: {
      en: { question: "Which song is this?", answer, aliases: [] },
      de: { question: "Welcher Song ist das?", answer, aliases: [] },
    },
  };
}

async function harness(...rounds: NewBankedRound[]) {
  const repository = createSqliteRoundRepository(":memory:");
  await repository.init();
  for (const round of rounds) await repository.insert(round, NOON, false);
  const source = createBankedRoundSource({
    repository,
    // Trailing slash on purpose: the source must not serve "…//img/…".
    publicBaseUrl: "http://game.test:3001/",
    now: () => NOON,
  });
  return { repository, source };
}

describe("a stocked bank", () => {
  it("serves a banked round with the image from our own origin", async () => {
    const round = bankedImage("Bhutan");
    const { source } = await harness(round);

    const sourced = await source.build(request(), NEVER);

    expect(sourced.answer).toBe("Bhutan");
    expect(sourced.content).toMatchObject({
      kind: "image",
      question: "Which country's flag is this?",
      imageUrl: `http://game.test:3001/img/${round.imageFile}`,
    });
  });

  /** The whole payoff: the German lobby is dealt the round the English one paid for. */
  it("serves a lobby in the other language from the same banked round", async () => {
    const { source } = await harness(bankedImage("France", "Frankreich"));
    const english = await source.build(request(), NEVER);

    const german = await source.build(request({ code: "ZZZZZ", language: "de" }), NEVER);

    expect(german.answer).toBe("Frankreich");
    expect(german.content).toMatchObject({ question: "Welches Land hat diese Flagge?" });
    // Same picture, different words.
    expect(german.content).toMatchObject({
      imageUrl: (english.content as { imageUrl: string }).imageUrl,
    });
  });

  /**
   * The German room is *asked* in German and reads the song in the language it
   * is sung in. A translated paraphrase of an English song is a round nobody
   * gets, so there is only ever one of them.
   */
  it("asks a lyrics round in the room's language and shows the song in its own", async () => {
    const { source } = await harness(bankedLyrics("Bohemian Rhapsody"));

    const sourced = await source.build(
      request({ topic: "music", kind: "lyrics", language: "de" }),
      NEVER,
    );

    expect(sourced.content).toMatchObject({
      kind: "lyrics",
      question: "Welcher Song ist das?",
      snippet: expect.stringContaining("did I make it up"),
      snippetLanguage: "en",
    });
  });

  it("respects a game's used answers", async () => {
    const { source } = await harness(bankedImage("Bhutan"), bankedImage("Japan"));

    const second = await source.build(request({ number: 2, exclude: ["Bhutan"] }), NEVER);

    expect(second.answer).toBe("Japan");
  });

  /** Least-served first, so the pool deals its whole shelf before repeating. */
  it("rotates: the second game is dealt the round the first was not", async () => {
    const { source } = await harness(bankedImage("Bhutan"), bankedImage("Japan"));

    const first = await source.build(request(), NEVER);
    const second = await source.build(request({ code: "ZZZZZ" }), NEVER);

    expect([first.answer, second.answer].sort()).toEqual(["Bhutan", "Japan"]);
  });
});

describe("guessing across languages", () => {
  /**
   * A German lobby sees "Frankreich" and is marked against it, but somebody
   * typing "France" has still named the thing on the screen — so every
   * language's answer and aliases ride along in the list the matcher uses.
   */
  it("accepts the other language's answer as an alias", async () => {
    const { source } = await harness(bankedImage("France", "Frankreich", ["French Republic"]));

    const german = await source.build(request({ language: "de" }), NEVER);

    expect(german.answer).toBe("Frankreich");
    expect(german.aliases).toContain("France");
    expect(german.aliases).toContain("French Republic");
  });

  /** A title is usually the same string in both, and one entry is enough. */
  it("does not repeat an answer both languages spell the same way", async () => {
    const { source } = await harness(bankedImage("Bhutan", "Bhutan"));

    const sourced = await source.build(request(), NEVER);

    expect(sourced.answer).toBe("Bhutan");
    expect(sourced.aliases).toEqual([]);
  });

  /**
   * The promise the lobby makes out loud — "a guess in another language still
   * counts" — put through the matcher that has to keep it. The two halves are
   * tested apart everywhere else; this is the one place they meet, and it is
   * the sentence a player would hold us to.
   */
  it("scores either language, and still refuses a wrong answer", async () => {
    const { source } = await harness(bankedImage("France", "Frankreich", ["French Republic"]));

    const round = await source.build(request({ language: "de" }), NEVER);
    const accepts = (guess: string) => matchesAnswer(guess, round.answer, round.aliases);

    expect(accepts("Frankreich")).toBe(true);
    expect(accepts("France")).toBe(true);
    expect(accepts("French Republic")).toBe(true);
    // Typing is forgiven in both, and being wrong is not.
    expect(accepts("Frankreih")).toBe(true);
    expect(accepts("Spain")).toBe(false);
  });
});

describe("a miss", () => {
  /**
   * The server never generates: an empty shelf is a failed build, and the
   * runner's retry-on-a-fresh-topic is what turns that into a hiccup rather
   * than a dead lobby. The message is the one a player may end up reading.
   */
  it("fails the round when the topic holds nothing", async () => {
    const { source } = await harness();

    await expect(source.build(request(), NEVER)).rejects.toThrowError(RoundSourceError);
    await expect(source.build(request(), NEVER)).rejects.toThrow(/no rounds stocked/i);
  });

  it("fails the round when the shelf is empty in the lobby's language", async () => {
    const round = bankedImage("Bhutan");
    round.texts = { en: round.texts.en! };
    const { source } = await harness(round);

    await expect(source.build(request({ language: "de" }), NEVER)).rejects.toThrowError(
      RoundSourceError,
    );
    // The English lobby is still served from the same round.
    await expect(source.build(request(), NEVER)).resolves.toMatchObject({ answer: "Bhutan" });
  });

  it("fails the round, not the process, when the bank cannot be read", async () => {
    const broken: RoundRepository = {
      init: async () => {},
      insert: () => Promise.reject(new Error("database is on fire")),
      draw: () => Promise.reject(new Error("database is on fire")),
      count: () => Promise.reject(new Error("database is on fire")),
      answers: async () => [],
      close: async () => {},
    };
    const source = createBankedRoundSource({
      repository: broken,
      publicBaseUrl: "http://game.test:3001",
      now: () => NOON,
    });

    await expect(source.build(request(), NEVER)).rejects.toThrowError(RoundSourceError);
  });
});
