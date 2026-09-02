import { describe, expect, it } from "vitest";
import type { LanguageId } from "@guessly/protocol";
import { parseSubmission } from "./schema.js";

/**
 * The schema makes the model's reply structurally valid; these are the rules
 * the schema cannot express. Every case here is something a real answer has to
 * survive being, because the alternative is a thrown exception in the middle of
 * a round with twelve people watching.
 */

const BOTH: LanguageId[] = ["en", "de"];

/** One language's entry, with only the field under test varied. */
const english = (overrides: Record<string, unknown> = {}) => ({
  language: "en",
  question: "Which country's flag is this?",
  answer: "Bhutan",
  aliases: ["Kingdom of Bhutan", "BHUTAN", "Druk Yul"],
  ...overrides,
});

const german = (overrides: Record<string, unknown> = {}) => ({
  language: "de",
  question: "Welches Land hat diese Flagge?",
  answer: "Bhutan",
  aliases: ["Königreich Bhutan"],
  ...overrides,
});

const imageSubmission = (overrides: Record<string, unknown> = {}) => ({
  subject: "Flag of Bhutan",
  image_urls: ["https://upload.wikimedia.org/flag_of_bhutan.svg.png"],
  lyrics_snippet: "",
  lyrics_language: "",
  versions: [english(), german()],
  ...overrides,
});

/**
 * One paraphrase for the whole round, because it is written in the song's own
 * language rather than the room's. Only the question and the answer are per
 * language here.
 */
const lyricsSubmission = (overrides: Record<string, unknown> = {}) => ({
  subject: "Bohemian Rhapsody by Queen",
  image_urls: [],
  lyrics_snippet: "Is any of this real,\nor did I make it up?\nThere is no getting out.",
  lyrics_language: "en",
  versions: [
    english({
      question: "Which song is this?",
      answer: "Bohemian Rhapsody",
      aliases: ["Queen"],
    }),
    german({
      question: "Welcher Song ist das?",
      answer: "Bohemian Rhapsody",
      aliases: ["Queen"],
    }),
  ],
  ...overrides,
});

/** The usual call: both languages, and the kind under test. */
const parse = (input: unknown, kind: "image" | "lyrics" = "image") =>
  parseSubmission(input, kind, BOTH);

describe("image rounds", () => {
  it("takes a well-formed submission", () => {
    const parsed = parse(imageSubmission());
    expect(parsed).toMatchObject({
      ok: true,
      kind: "image",
      subject: "Flag of Bhutan",
      imageUrls: ["https://upload.wikimedia.org/flag_of_bhutan.svg.png"],
    });
    expect(parsed.ok && parsed.texts.en?.question).toBe("Which country's flag is this?");
    expect(parsed.ok && parsed.texts.de?.question).toBe("Welches Land hat diese Flagge?");
  });

  it("tries the URLs that look like image files first", () => {
    const parsed = parse(
      imageSubmission({
        image_urls: [
          "https://example.test/page-about-bhutan",
          "https://example.test/flag.jpg",
        ],
      }),
    );
    expect(parsed).toMatchObject({
      imageUrls: ["https://example.test/flag.jpg", "https://example.test/page-about-bhutan"],
    });
  });

  it("drops what cannot be an image URL at all", () => {
    const parsed = parse(
      imageSubmission({
        image_urls: ["http://example.test/insecure.png", "not a url", "", 42],
      }),
    );
    expect(parsed).toMatchObject({ ok: false });
    // The retry is only as good as the reason it is given: unusable URLs and
    // none at all are different mistakes to have made. The count is of what
    // was actually a string — the empty one and the number never were.
    expect(parsed).toMatchObject({ reason: expect.stringContaining("2 URLs") });
  });

  it("says so when an image round came back with no URLs at all", () => {
    expect(parse(imageSubmission({ image_urls: [] }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining("no image URLs at all"),
    });
  });

  it("keeps at most five", () => {
    const parsed = parse(
      imageSubmission({
        image_urls: Array.from({ length: 8 }, (_, i) => `https://example.test/${i}.png`),
      }),
    );
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && parsed.kind === "image" && parsed.imageUrls).toHaveLength(5);
  });

  it("dedupes the aliases and never repeats the answer among them", () => {
    const parsed = parse(
      imageSubmission({
        versions: [
          english({ aliases: ["bhutan", "Kingdom of Bhutan", "KINGDOM OF BHUTAN", "Druk Yul"] }),
          german(),
        ],
      }),
    );
    expect(parsed.ok && parsed.texts.en?.aliases).toEqual(["Kingdom of Bhutan", "Druk Yul"]);
  });
});

describe("lyrics rounds", () => {
  it("takes a well-formed submission", () => {
    const parsed = parse(lyricsSubmission(), "lyrics");
    expect(parsed).toMatchObject({
      ok: true,
      kind: "lyrics",
      snippet: expect.stringContaining("did I make it up"),
      snippetLanguage: "en",
    });
    // Asked in each language; shown in the song's.
    expect(parsed.ok && parsed.texts.de?.question).toBe("Welcher Song ist das?");
  });

  it("refuses a snippet with the title in it", () => {
    const parsed = parse(
      lyricsSubmission({
        lyrics_snippet: "A rhapsody, bohemian and long,\nsung by nobody in particular.",
      }),
      "lyrics",
    );
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining("gave the song away") });
  });

  /**
   * There is one snippet and each room is scored against its own answer, so a
   * paraphrase is checked against all of them — a leak in German is a broken
   * round for German lobbies whatever it does for the English ones.
   */
  it("refuses a snippet that gives away only the other language's answer", () => {
    const parsed = parse(
      lyricsSubmission({
        // German, because that is the language the song is sung in, and it
        // names the German answer while leaving the English one alone.
        lyrics_snippet: "In der stillen Nacht ist alles ruhig, und zwei sind wach.",
        lyrics_language: "de",
        versions: [
          english({ question: "Which song is this?", answer: "Silent Night", aliases: [] }),
          german({ question: "Welcher Song ist das?", answer: "Stille Nacht", aliases: [] }),
        ],
      }),
      "lyrics",
    );
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining("in de") });
  });

  it("refuses a snippet that is really a lyric sheet", () => {
    const parsed = parse(
      lyricsSubmission({
        lyrics_snippet: Array.from({ length: 12 }, () => "a line of text").join("\n"),
      }),
      "lyrics",
    );
    expect(parsed).toMatchObject({ ok: false });
  });

  it("refuses an empty snippet", () => {
    expect(parse(lyricsSubmission({ lyrics_snippet: "  " }), "lyrics")).toMatchObject({
      ok: false,
    });
  });

  /**
   * The tag is a hint for a `lang` attribute, not a rule. A song may be in a
   * language this game has never heard of, so anything shaped like a tag is
   * kept and anything else is dropped — marking the lines with a guess would
   * be worse for a screen reader than not marking them at all.
   */
  it("keeps a language tag it has never heard of", () => {
    const parsed = parse(lyricsSubmission({ lyrics_language: "cy" }), "lyrics");
    expect(parsed).toMatchObject({ ok: true, snippetLanguage: "cy" });
  });

  it.each(["", "German", "e", "a much longer sentence"])(
    "drops a language tag that is not one rather than failing the round: %j",
    (tag) => {
      const parsed = parse(lyricsSubmission({ lyrics_language: tag }), "lyrics");
      expect(parsed).toMatchObject({ ok: true, snippetLanguage: null });
    },
  );
});

describe("the languages", () => {
  /**
   * The rule the whole shape exists for. A round missing a language is one the
   * lobbies playing in it can never be dealt, and it would sit on the shelf
   * looking perfectly healthy — so it is refused here, where the reason can
   * still be told to the model.
   */
  it("refuses a submission that left one out", () => {
    const parsed = parse(imageSubmission({ versions: [english()] }));
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining("de") });
  });

  it("refuses one that came back with none at all", () => {
    expect(parse(imageSubmission({ versions: [] }))).toMatchObject({ ok: false });
  });

  /** Wasted work rather than a broken round, so it is dropped and not refused. */
  it("ignores a language nobody asked for", () => {
    const parsed = parse(
      imageSubmission({ versions: [english(), german(), { ...english(), language: "fr" }] }),
    );
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && Object.keys(parsed.texts).sort()).toEqual(["de", "en"]);
  });

  it("keeps the first entry when a language is submitted twice", () => {
    const parsed = parse(
      imageSubmission({ versions: [english(), german(), english({ answer: "Nepal" })] }),
    );
    expect(parsed.ok && parsed.texts.en?.answer).toBe("Bhutan");
  });

  it("writes only the language asked for when only one was", () => {
    const parsed = parseSubmission(imageSubmission(), "image", ["en"]);
    expect(parsed.ok && Object.keys(parsed.texts)).toEqual(["en"]);
  });

  /** Which language broke the round is the first thing the retry has to say. */
  it("names the language in the reason", () => {
    const parsed = parse(imageSubmission({ versions: [english(), german({ answer: "" })] }));
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining("for de") });
  });
});

describe("the question", () => {
  it("is required", () => {
    expect(parse(imageSubmission({ versions: [english({ question: "" }), german()] }))).toMatchObject(
      { ok: false },
    );
  });

  it("may not give the answer away", () => {
    const parsed = parse(
      imageSubmission({
        versions: [english({ question: "Which flag belongs to Bhutan?" }), german()],
      }),
    );
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("the answer", () => {
  it("is required", () => {
    expect(parse(imageSubmission({ versions: [english({ answer: "   " }), german()] }))).toMatchObject(
      { ok: false },
    );
  });

  it("has to be short enough to type inside twenty seconds", () => {
    const parsed = parse(
      imageSubmission({ versions: [english({ answer: "a".repeat(200) }), german()] }),
    );
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("garbage", () => {
  /**
   * The `strict` schema should mean none of this ever arrives. This exists
   * because "should" is not a thing to put a live game on: whatever turns up
   * here comes back as a rejection with a reason, never as a throw.
   */
  it.each([
    null,
    undefined,
    "a string",
    42,
    [],
    {},
    { versions: "not an array" },
    { versions: [null, 12, { language: 5 }] },
    { versions: [{ language: "en", answer: 12, question: [] }] },
  ])("comes back as a rejection rather than an exception: %j", (input) => {
    expect(() => parse(input)).not.toThrow();
    expect(parse(input)).toMatchObject({ ok: false });
    expect(parse(input, "lyrics")).toMatchObject({ ok: false });
  });
});
