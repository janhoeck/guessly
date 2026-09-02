import { describe, expect, it } from "vitest";
import type { DownloadedImage } from "../content/download.js";
import {
  RoundSourceError,
  type GeneratedRound,
  type GeneratedTexts,
  type GenerationRequest,
  type RoundGenerator,
} from "../content/source.js";
import { matchesAnswer } from "../lobby/matching.js";
import type { RoundRequest } from "../lobby/store.js";
import type { ImageStore } from "./images.js";
import type { RoundRepository } from "./repository.js";
import { createBankedRoundSource } from "./source.js";
import { createSqliteRoundRepository } from "./sqlite.js";

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

/** The same subject named in both languages, which is what a generation is. */
function texts(en: string, de: string, aliases: string[] = []): GeneratedTexts {
  return {
    en: { question: "Which country's flag is this?", answer: en, aliases },
    de: { question: "Welches Land hat diese Flagge?", answer: de, aliases: [] },
  };
}

function imageRound(en: string, de = en, aliases: string[] = []): GeneratedRound {
  return {
    kind: "image",
    subject: en,
    texts: texts(en, de, aliases),
    image: {
      bytes: Buffer.from(en),
      contentType: "image/png",
      extension: "png",
      sourceUrl: `https://example.test/${en.toLowerCase()}.png`,
    },
  };
}

function lyricsRound(answer: string): GeneratedRound {
  return {
    kind: "lyrics",
    subject: answer,
    snippetLanguage: "en",
    snippet: "Is any of this real,\nor did I make it up?",
    texts: {
      en: { question: "Which song is this?", answer, aliases: [] },
      de: { question: "Welcher Song ist das?", answer, aliases: [] },
    },
  };
}

/** Hands out queued rounds and remembers what it was asked. */
function generatorOf(...rounds: GeneratedRound[]): RoundGenerator & {
  requests: GenerationRequest[];
} {
  const queue = [...rounds];
  const requests: GenerationRequest[] = [];
  return {
    requests,
    async generate(generationRequest) {
      requests.push(generationRequest);
      const next = queue.shift();
      if (!next) throw new RoundSourceError("the stub has nothing left");
      return next;
    },
  };
}

function fakeImages(): ImageStore & { saved: DownloadedImage[] } {
  const saved: DownloadedImage[] = [];
  return {
    saved,
    async init() {},
    async save(image) {
      saved.push(image);
      return `${String(saved.length).padStart(64, "0")}.${image.extension}`;
    },
    resolve: () => null,
  };
}

async function harness(options: { generator?: RoundGenerator; lowWater?: number } = {}) {
  const repository = createSqliteRoundRepository(":memory:");
  await repository.init();
  const images = fakeImages();
  const generator = options.generator ?? generatorOf();
  const source = createBankedRoundSource({
    repository,
    images,
    generator,
    // Trailing slash on purpose: the source must not serve "…//img/…".
    publicBaseUrl: "http://game.test:3001/",
    // Zero by default so background top-ups never muddy a foreground test.
    lowWater: options.lowWater ?? 0,
    now: () => NOON,
  });
  return { repository, images, generator, source };
}

describe("an empty bank", () => {
  it("generates, banks, and serves the image from our own origin", async () => {
    const generator = generatorOf(imageRound("Bhutan"));
    const { source, repository } = await harness({ generator });

    const sourced = await source.build(request(), NEVER);

    expect(sourced.answer).toBe("Bhutan");
    expect(sourced.content).toMatchObject({
      kind: "image",
      question: "Which country's flag is this?",
      imageUrl: `http://game.test:3001/img/${String(1).padStart(64, "0")}.png`,
    });
    expect(generator.requests).toHaveLength(1);
    expect(await repository.count("flags", "en")).toBe(1);
  });

  /**
   * The point of asking for every language in one call: one search, one
   * download, one cached prompt, and the other language's lobbies are a bank
   * hit from then on rather than another three seconds and another picture.
   */
  it("asks for every language at once, whatever the lobby plays in", async () => {
    const generator = generatorOf(imageRound("France", "Frankreich"));
    const { source, repository, images } = await harness({ generator });

    await source.build(request({ language: "de" }), NEVER);

    expect(generator.requests[0]?.languages).toEqual(["en", "de"]);
    expect(images.saved).toHaveLength(1);
    expect(await repository.count("flags", "en")).toBe(1);
    expect(await repository.count("flags", "de")).toBe(1);
  });

  /**
   * The German room is *asked* in German and reads the song in the language it
   * is sung in. A translated paraphrase of an English song is a round nobody
   * gets, so there is only ever one of them.
   */
  it("asks a lyrics round in the room's language and shows the song in its own", async () => {
    const generator = generatorOf(lyricsRound("Bohemian Rhapsody"));
    const { source } = await harness({ generator });

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
});

describe("a stocked bank", () => {
  it("serves the next game without asking the generator", async () => {
    const generator = generatorOf(imageRound("Bhutan"));
    const { source } = await harness({ generator });
    await source.build(request(), NEVER);

    const again = await source.build(request({ code: "ZZZZZ" }), NEVER);

    expect(again.answer).toBe("Bhutan");
    expect(again.content).toMatchObject({ kind: "image", imageUrl: expect.stringContaining("/img/") });
    expect(generator.requests).toHaveLength(1);
  });

  /** The whole payoff: the German lobby is dealt the round the English one paid for. */
  it("serves a lobby in the other language from the same banked round", async () => {
    const generator = generatorOf(imageRound("France", "Frankreich"));
    const { source, images } = await harness({ generator });
    const english = await source.build(request(), NEVER);

    const german = await source.build(request({ code: "ZZZZZ", language: "de" }), NEVER);

    expect(generator.requests).toHaveLength(1);
    expect(images.saved).toHaveLength(1);
    expect(german.answer).toBe("Frankreich");
    expect(german.content).toMatchObject({ question: "Welches Land hat diese Flagge?" });
    // Same picture, different words.
    expect(german.content).toMatchObject({ imageUrl: (english.content as { imageUrl: string }).imageUrl });
  });

  it("respects a game's used answers and generates fresh instead", async () => {
    const generator = generatorOf(imageRound("Bhutan"), imageRound("Japan"));
    const { source, repository } = await harness({ generator });
    await source.build(request(), NEVER);

    const second = await source.build(request({ number: 2, exclude: ["Bhutan"] }), NEVER);

    expect(second.answer).toBe("Japan");
    expect(await repository.count("flags", "en")).toBe(2);
  });

  it("tops a low topic back up in the background after a hit", async () => {
    const generator = generatorOf(imageRound("Bhutan"), imageRound("Japan"));
    const { source, repository } = await harness({ generator, lowWater: 2 });
    await source.build(request(), NEVER);

    // Bhutan came from the generator and was banked; the draw below is a hit.
    await source.build(request({ code: "ZZZZZ" }), NEVER);
    await source.drain();

    expect(await repository.count("flags", "en")).toBe(2);
    // The top-up was told what the topic already holds, in every language.
    expect(generator.requests.at(-1)?.exclude).toContain("Bhutan");
    expect(generator.requests.at(-1)?.languages).toEqual(["en", "de"]);
  });
});

describe("guessing across languages", () => {
  /**
   * A German lobby sees "Frankreich" and is marked against it, but somebody
   * typing "France" has still named the thing on the screen — so every
   * language's answer and aliases ride along in the list the matcher uses.
   */
  it("accepts the other language's answer as an alias", async () => {
    const generator = generatorOf(imageRound("France", "Frankreich", ["French Republic"]));
    const { source } = await harness({ generator });

    const german = await source.build(request({ language: "de" }), NEVER);

    expect(german.answer).toBe("Frankreich");
    expect(german.aliases).toContain("France");
    expect(german.aliases).toContain("French Republic");
  });

  /** A title is usually the same string in both, and one entry is enough. */
  it("does not repeat an answer both languages spell the same way", async () => {
    const generator = generatorOf(imageRound("Bhutan", "Bhutan"));
    const { source } = await harness({ generator });

    const sourced = await source.build(request(), NEVER);

    expect(sourced.answer).toBe("Bhutan");
    expect(sourced.aliases).toEqual([]);
  });

  it("carries the same list back out of the bank on the next game", async () => {
    const generator = generatorOf(imageRound("France", "Frankreich"));
    const { source } = await harness({ generator });
    await source.build(request(), NEVER);

    const drawn = await source.build(request({ code: "ZZZZZ", language: "de" }), NEVER);

    expect(drawn.aliases).toContain("France");
  });

  /**
   * The promise the lobby makes out loud — "a guess in another language still
   * counts" — put through the matcher that has to keep it. The two halves are
   * tested apart everywhere else; this is the one place they meet, and it is
   * the sentence a player would hold us to.
   */
  it("scores either language, and still refuses a wrong answer", async () => {
    const generator = generatorOf(imageRound("France", "Frankreich", ["French Republic"]));
    const { source } = await harness({ generator });

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

describe("the bank never fails a round", () => {
  it("serves a duplicate the generator produced without banking it twice", async () => {
    const generator = generatorOf(imageRound("Bhutan"), imageRound("Bhutan"));
    const { source, repository } = await harness({ generator });
    await source.build(request(), NEVER);

    // The model ignored the exclusion; the round is still played.
    const again = await source.build(request({ number: 2, exclude: ["Bhutan"] }), NEVER);

    expect(again.answer).toBe("Bhutan");
    expect(await repository.count("flags", "en")).toBe(1);
  });

  it("serves from the source host when the image cannot be stored", async () => {
    const generator = generatorOf(imageRound("Bhutan"));
    const { repository } = await harness();
    const source = createBankedRoundSource({
      repository,
      images: {
        async init() {},
        save: () => Promise.reject(new Error("disk full")),
        resolve: () => null,
      },
      generator,
      publicBaseUrl: "http://game.test:3001",
      lowWater: 0,
      now: () => NOON,
    });

    const sourced = await source.build(request(), NEVER);

    expect(sourced.content).toMatchObject({
      kind: "image",
      imageUrl: "https://example.test/bhutan.png",
    });
    // Unservable later, so not banked.
    expect(await repository.count("flags", "en")).toBe(0);
  });

  it("falls through to the generator when the bank itself is broken", async () => {
    const broken: RoundRepository = {
      init: async () => {},
      insert: () => Promise.reject(new Error("database is on fire")),
      draw: () => Promise.reject(new Error("database is on fire")),
      count: () => Promise.reject(new Error("database is on fire")),
      answers: async () => [],
      close: async () => {},
    };
    const generator = generatorOf(imageRound("Bhutan"));
    const source = createBankedRoundSource({
      repository: broken,
      images: fakeImages(),
      generator,
      publicBaseUrl: "http://game.test:3001",
      lowWater: 0,
      now: () => NOON,
    });

    const sourced = await source.build(request(), NEVER);
    expect(sourced.answer).toBe("Bhutan");
    expect(sourced.content).toMatchObject({ kind: "image", imageUrl: expect.stringContaining("/img/") });
  });
});
