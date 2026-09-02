import { describe, expect, it } from "vitest";
import type { DownloadedImage } from "../content/download.js";
import {
  RoundSourceError,
  type GeneratedRound,
  type GenerationRequest,
  type RoundGenerator,
} from "../content/source.js";
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
    exclude: [],
    startsAt: NOON,
    ...overrides,
  };
}

function imageRound(answer: string): GeneratedRound {
  return {
    kind: "image",
    question: "Which country's flag is this?",
    answer,
    aliases: [],
    subject: `Flag of ${answer}`,
    image: {
      bytes: Buffer.from(answer),
      contentType: "image/png",
      extension: "png",
      sourceUrl: `https://example.test/${answer.toLowerCase()}.png`,
    },
  };
}

function lyricsRound(answer: string): GeneratedRound {
  return {
    kind: "lyrics",
    question: "Which song is this?",
    answer,
    aliases: [],
    subject: answer,
    snippet: "Is any of this real,\nor did I make it up?",
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
      imageUrl: `http://game.test:3001/img/${String(1).padStart(64, "0")}.png`,
    });
    expect(generator.requests).toHaveLength(1);
    expect(await repository.count("flags")).toBe(1);
  });

  it("banks a lyrics round with its snippet", async () => {
    const generator = generatorOf(lyricsRound("Bohemian Rhapsody"));
    const { source, repository } = await harness({ generator });

    const sourced = await source.build(request({ topic: "music", kind: "lyrics" }), NEVER);

    expect(sourced.content).toMatchObject({ kind: "lyrics", snippet: expect.stringContaining("real") });
    expect(await repository.count("music")).toBe(1);
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

  it("respects a game's used answers and generates fresh instead", async () => {
    const generator = generatorOf(imageRound("Bhutan"), imageRound("Japan"));
    const { source, repository } = await harness({ generator });
    await source.build(request(), NEVER);

    const second = await source.build(request({ number: 2, exclude: ["Bhutan"] }), NEVER);

    expect(second.answer).toBe("Japan");
    expect(await repository.count("flags")).toBe(2);
  });

  it("tops a low topic back up in the background after a hit", async () => {
    const generator = generatorOf(imageRound("Bhutan"), imageRound("Japan"));
    const { source, repository } = await harness({ generator, lowWater: 2 });
    await source.build(request(), NEVER);

    // Bhutan came from the generator and was banked; the draw below is a hit.
    await source.build(request({ code: "ZZZZZ" }), NEVER);
    await source.drain();

    expect(await repository.count("flags")).toBe(2);
    // The top-up was told what the shelf already holds.
    expect(generator.requests.at(-1)?.exclude).toContain("Bhutan");
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
    expect(await repository.count("flags")).toBe(1);
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
    expect(await repository.count("flags")).toBe(0);
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
