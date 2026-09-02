import { describe, expect, it } from "vitest";
import { createSqliteRoundRepository, type ImageStore, type NewBankedRound, type StorableImage } from "@guessly/bank";
import {
  RoundSourceError,
  type GeneratedRound,
  type GenerationRequest,
  type RoundGenerator,
} from "./content/source.js";
import { createBankFiller } from "./fill.js";

const NOON = 1_700_000_000_000;
const NEVER = new AbortController().signal;

function imageRound(en: string, de = en): GeneratedRound {
  return {
    kind: "image",
    subject: en,
    texts: {
      en: { question: "Which country's flag is this?", answer: en, aliases: [] },
      de: { question: "Welches Land hat diese Flagge?", answer: de, aliases: [] },
    },
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
    snippet: "Is any of this real,\nor did I make it up?",
    snippetLanguage: "en",
    texts: {
      en: { question: "Which song is this?", answer, aliases: [] },
      de: { question: "Welcher Song ist das?", answer, aliases: [] },
    },
  };
}

/** What a round looks like once banked, for seeding shelves directly. */
function banked(topic: "flags" | "music", subject: string): NewBankedRound {
  const generated = topic === "music" ? lyricsRound(subject) : imageRound(subject);
  return {
    topic,
    kind: generated.kind,
    subject,
    imageFile: generated.kind === "image" ? `${"0".repeat(64)}.png` : null,
    sourceUrl: generated.kind === "image" ? generated.image.sourceUrl : null,
    snippet: generated.kind === "lyrics" ? generated.snippet : null,
    snippetLanguage: generated.kind === "lyrics" ? generated.snippetLanguage : null,
    texts: generated.texts,
  };
}

/** Hands out queued rounds — or throws queued failures — and remembers the asks. */
function generatorOf(...queue: (GeneratedRound | Error)[]): RoundGenerator & {
  requests: GenerationRequest[];
} {
  const remaining = [...queue];
  const requests: GenerationRequest[] = [];
  return {
    requests,
    async generate(request) {
      requests.push(request);
      const next = remaining.shift();
      if (!next) throw new RoundSourceError("the stub has nothing left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function fakeImages(): ImageStore & { saved: StorableImage[] } {
  const saved: StorableImage[] = [];
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

async function harness(options: {
  generator: RoundGenerator;
  topics?: readonly ("flags" | "music")[];
  seed?: NewBankedRound[];
}) {
  const repository = createSqliteRoundRepository(":memory:");
  await repository.init();
  for (const round of options.seed ?? []) await repository.insert(round, NOON, false);
  const images = fakeImages();
  const clock = { now: NOON };
  const filler = createBankFiller({
    repository,
    images,
    generator: options.generator,
    topics: options.topics ?? ["flags", "music"],
    languages: ["en", "de"],
    now: () => clock.now,
  });
  return { repository, images, filler, clock };
}

describe("filling", () => {
  it("fills the thinnest shelf first", async () => {
    const generator = generatorOf(lyricsRound("Bohemian Rhapsody"));
    const { filler, repository } = await harness({
      generator,
      seed: [banked("flags", "Bhutan")],
    });

    const outcome = await filler.fillOnce(NEVER);

    expect(outcome).toMatchObject({ kind: "filled", topic: "music", level: 1 });
    expect(generator.requests[0]).toMatchObject({ topic: "music", kind: "lyrics" });
    expect(await repository.count("music", "en")).toBe(1);
  });

  it("asks for every language at once, with the shelf's answers excluded", async () => {
    const generator = generatorOf(imageRound("Japan"));
    const bhutan = banked("flags", "Bhutan");
    bhutan.texts.en!.aliases = ["Druk Yul"];
    const { filler, repository, images } = await harness({
      generator,
      topics: ["flags"],
      seed: [bhutan],
    });

    const outcome = await filler.fillOnce(NEVER);

    expect(outcome).toMatchObject({ kind: "filled", topic: "flags", subject: "Japan", level: 2 });
    expect(generator.requests[0]).toMatchObject({ number: 2, languages: ["en", "de"] });
    // Banked in two languages under one name; the prompt's list says it once.
    expect(generator.requests[0]?.exclude).toEqual(["Bhutan"]);
    // The aliases ride along for the duplicate check, unshown in the prompt.
    expect(generator.requests[0]?.excludeAliases).toContain("Druk Yul");
    // The picture is stored, and both languages land on the one round.
    expect(images.saved).toHaveLength(1);
    expect(await repository.count("flags", "en")).toBe(2);
    expect(await repository.count("flags", "de")).toBe(2);
  });

  it("reports how full the shelves are", async () => {
    const { filler } = await harness({
      generator: generatorOf(),
      seed: [banked("flags", "Bhutan"), banked("flags", "Japan")],
    });

    expect(await filler.shelves()).toEqual([
      { topic: "flags", counts: { en: 2, de: 2 }, level: 2 },
      { topic: "music", counts: { en: 0, de: 0 }, level: 0 },
    ]);
  });
});

describe("benching", () => {
  it("benches a topic whose generation failed and moves on", async () => {
    const generator = generatorOf(new Error("nothing sourceable"), lyricsRound("Africa"));
    const { filler, clock } = await harness({ generator });

    const failed = await filler.fillOnce(NEVER);
    expect(failed).toMatchObject({ kind: "failed", topic: "flags", retryAt: clock.now + 30_000 });

    // The very next fill skips the benched topic even though it is thinnest-equal.
    const next = await filler.fillOnce(NEVER);
    expect(next).toMatchObject({ kind: "filled", topic: "music" });
  });

  it("benches a topic the generator repeated an answer for", async () => {
    const generator = generatorOf(imageRound("Bhutan"));
    const { filler, repository } = await harness({
      generator,
      topics: ["flags"],
      seed: [banked("flags", "Bhutan")],
    });

    const outcome = await filler.fillOnce(NEVER);

    expect(outcome).toMatchObject({ kind: "duplicate", topic: "flags", subject: "Bhutan" });
    expect(await repository.count("flags", "en")).toBe(1);
  });

  it("rests when every topic is benched, until the earliest comes back", async () => {
    const generator = generatorOf(new Error("down"), imageRound("Bhutan"));
    const { filler, clock } = await harness({ generator, topics: ["flags"] });

    const failed = await filler.fillOnce(NEVER);
    expect(failed.kind).toBe("failed");
    const retryAt = failed.kind === "failed" ? failed.retryAt : 0;

    expect(await filler.fillOnce(NEVER)).toEqual({ kind: "resting", until: retryAt });

    // Once the bench expires the topic is tried again.
    clock.now = retryAt;
    expect(await filler.fillOnce(NEVER)).toMatchObject({ kind: "filled", topic: "flags" });
  });

  it("doubles the bench per consecutive failure and resets it on a success", async () => {
    const generator = generatorOf(
      new Error("down"),
      new Error("still down"),
      imageRound("Bhutan"),
      new Error("down again"),
    );
    const { filler, clock } = await harness({ generator, topics: ["flags"] });

    const first = await filler.fillOnce(NEVER);
    expect(first).toMatchObject({ kind: "failed", retryAt: clock.now + 30_000 });

    clock.now += 30_000;
    const second = await filler.fillOnce(NEVER);
    expect(second).toMatchObject({ kind: "failed", retryAt: clock.now + 60_000 });

    clock.now += 60_000;
    expect(await filler.fillOnce(NEVER)).toMatchObject({ kind: "filled" });

    // The streak is gone: the next failure starts over at the base bench.
    const after = await filler.fillOnce(NEVER);
    expect(after).toMatchObject({ kind: "failed", retryAt: clock.now + 30_000 });
  });

  it("lets an abort out rather than blaming the topic", async () => {
    const controller = new AbortController();
    const generator: RoundGenerator = {
      async generate() {
        controller.abort();
        throw new Error("request aborted");
      },
    };
    const { filler } = await harness({ generator });

    await expect(filler.fillOnce(controller.signal)).rejects.toThrow("request aborted");
  });
});
