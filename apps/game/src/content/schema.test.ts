import { describe, expect, it } from "vitest";
import { parseSubmission } from "./schema.js";

/**
 * The schema makes the model's reply structurally valid; these are the rules
 * the schema cannot express. Every case here is something a real answer has to
 * survive being, because the alternative is a thrown exception in the middle of
 * a round with twelve people watching.
 */

const imageSubmission = (overrides: Record<string, unknown> = {}) => ({
  subject: "Flag of Bhutan",
  question: "Which country's flag is this?",
  answer: "Bhutan",
  aliases: ["Kingdom of Bhutan", "BHUTAN", "Druk Yul"],
  image_urls: ["https://upload.wikimedia.org/flag_of_bhutan.svg.png"],
  lyrics_snippet: "",
  ...overrides,
});

const lyricsSubmission = (overrides: Record<string, unknown> = {}) => ({
  subject: "Bohemian Rhapsody by Queen",
  question: "Which song is this?",
  answer: "Bohemian Rhapsody",
  aliases: ["Queen"],
  image_urls: [],
  lyrics_snippet: "Is any of this real,\nor did I make it up?\nThere is no getting out.",
  ...overrides,
});

describe("image rounds", () => {
  it("takes a well-formed submission", () => {
    const parsed = parseSubmission(imageSubmission(), "image");
    expect(parsed).toMatchObject({
      ok: true,
      kind: "image",
      question: "Which country's flag is this?",
      answer: "Bhutan",
      imageUrls: ["https://upload.wikimedia.org/flag_of_bhutan.svg.png"],
    });
  });

  it("tries the URLs that look like image files first", () => {
    const parsed = parseSubmission(
      imageSubmission({
        image_urls: [
          "https://example.test/page-about-bhutan",
          "https://example.test/flag.jpg",
        ],
      }),
      "image",
    );
    expect(parsed).toMatchObject({
      imageUrls: ["https://example.test/flag.jpg", "https://example.test/page-about-bhutan"],
    });
  });

  it("drops what cannot be an image URL at all", () => {
    const parsed = parseSubmission(
      imageSubmission({
        image_urls: ["http://example.test/insecure.png", "not a url", "", 42],
      }),
      "image",
    );
    expect(parsed).toMatchObject({ ok: false });
  });

  it("keeps at most five", () => {
    const parsed = parseSubmission(
      imageSubmission({
        image_urls: Array.from({ length: 8 }, (_, i) => `https://example.test/${i}.png`),
      }),
      "image",
    );
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.ok && parsed.kind === "image" && parsed.imageUrls).toHaveLength(5);
  });

  it("dedupes the aliases and never repeats the answer among them", () => {
    const parsed = parseSubmission(
      imageSubmission({ aliases: ["bhutan", "Kingdom of Bhutan", "KINGDOM OF BHUTAN", "Druk Yul"] }),
      "image",
    );
    expect(parsed).toMatchObject({ aliases: ["Kingdom of Bhutan", "Druk Yul"] });
  });
});

describe("lyrics rounds", () => {
  it("takes a well-formed submission", () => {
    expect(parseSubmission(lyricsSubmission(), "lyrics")).toMatchObject({
      ok: true,
      kind: "lyrics",
      answer: "Bohemian Rhapsody",
    });
  });

  it("refuses a snippet with the title in it", () => {
    const parsed = parseSubmission(
      lyricsSubmission({ lyrics_snippet: "A rhapsody, bohemian and long,\nsung by nobody in particular." }),
      "lyrics",
    );
    expect(parsed).toMatchObject({ ok: false });
  });

  it("refuses a snippet that is really a lyric sheet", () => {
    const parsed = parseSubmission(
      lyricsSubmission({ lyrics_snippet: Array.from({ length: 12 }, () => "a line of text").join("\n") }),
      "lyrics",
    );
    expect(parsed).toMatchObject({ ok: false });
  });

  it("refuses an empty snippet", () => {
    expect(parseSubmission(lyricsSubmission({ lyrics_snippet: "  " }), "lyrics")).toMatchObject({
      ok: false,
    });
  });
});

describe("the question", () => {
  it("is required", () => {
    expect(parseSubmission(imageSubmission({ question: "" }), "image")).toMatchObject({ ok: false });
  });

  it("may not give the answer away", () => {
    const parsed = parseSubmission(
      imageSubmission({ question: "Which flag belongs to Bhutan?" }),
      "image",
    );
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("the answer", () => {
  it("is required", () => {
    expect(parseSubmission(imageSubmission({ answer: "   " }), "image")).toMatchObject({ ok: false });
  });

  it("has to be short enough to type inside twenty seconds", () => {
    const parsed = parseSubmission(imageSubmission({ answer: "a".repeat(200) }), "image");
    expect(parsed).toMatchObject({ ok: false });
  });
});

describe("garbage", () => {
  /**
   * The `strict` schema should mean none of this ever arrives. This exists
   * because "should" is not a thing to put a live game on: whatever turns up
   * here comes back as a rejection with a reason, never as a throw.
   */
  it.each([null, undefined, "a string", 42, [], {}, { answer: 12, question: [] }])(
    "comes back as a rejection rather than an exception: %j",
    (input) => {
      expect(() => parseSubmission(input, "image")).not.toThrow();
      expect(parseSubmission(input, "image")).toMatchObject({ ok: false });
      expect(parseSubmission(input, "lyrics")).toMatchObject({ ok: false });
    },
  );
});
