import { describe, expect, it } from "vitest";
import type { BankedRoundRecord } from "@guessly/bank";
import {
  ANSWER_MAX_LENGTH,
  MAX_ALIASES,
  QUESTION_MAX_LENGTH,
  SNIPPET_MAX_LINES,
  parseRoundForm,
  parseSourceUrl,
  splitAliases,
} from "./form";

const NOON = 1_700_000_000_000;

const flag: BankedRoundRecord = {
  id: 7,
  topic: "flags",
  kind: "image",
  subject: "Flag of France",
  imageFile: `${"a".repeat(64)}.png`,
  sourceUrl: "https://example.test/flag.png",
  snippet: null,
  snippetLanguage: null,
  texts: {
    en: { question: "Which country's flag is this?", answer: "France", aliases: ["French Republic"] },
    de: { question: "Welches Land hat diese Flagge?", answer: "Frankreich", aliases: [] },
  },
  createdAt: NOON,
  timesServed: 0,
  lastServedAt: null,
};

const song: BankedRoundRecord = {
  ...flag,
  id: 8,
  topic: "music",
  kind: "lyrics",
  subject: "Bohemian Rhapsody",
  imageFile: null,
  sourceUrl: null,
  snippet: "Is any of this real,\nor did I make it up?",
  snippetLanguage: "en",
  texts: {
    en: { question: "Which song is this?", answer: "Bohemian Rhapsody", aliases: ["Queen"] },
  },
};

/** The form as the editor would submit it for `round`, untouched. */
function formFor(round: BankedRoundRecord, edits: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("subject", round.subject);
  form.set("topic", round.topic);
  form.set("snippet", round.snippet ?? "");
  form.set("snippetLanguage", round.snippetLanguage ?? "");
  for (const language of ["en", "de"] as const) {
    const text = round.texts[language];
    form.set(`${language}.question`, text?.question ?? "");
    form.set(`${language}.answer`, text?.answer ?? "");
    form.set(`${language}.aliases`, text?.aliases.join("\n") ?? "");
  }
  for (const [name, value] of Object.entries(edits)) form.set(name, value);
  return form;
}

describe("parseRoundForm", () => {
  it("is an empty patch for a form nobody touched", () => {
    expect(parseRoundForm(formFor(flag), flag)).toEqual({ ok: true, patch: {}, changed: false });
    expect(parseRoundForm(formFor(song), song)).toEqual({ ok: true, patch: {}, changed: false });
  });

  it("names only what changed, per language", () => {
    const result = parseRoundForm(
      formFor(flag, { subject: "  Tricolore ", "de.aliases": "Französische Republik\n\nFrankreich\nfranzösische republik" }),
      flag,
    );
    expect(result).toEqual({
      ok: true,
      changed: true,
      patch: {
        subject: "Tricolore",
        texts: {
          de: { question: "Welches Land hat diese Flagge?", answer: "Frankreich", aliases: ["Französische Republik"] },
        },
      },
    });
  });

  it("removes a language whose question and answer were both cleared", () => {
    const result = parseRoundForm(formFor(flag, { "de.question": "", "de.answer": "" }), flag);
    expect(result).toEqual({ ok: true, changed: true, patch: { texts: { de: null } } });
  });

  it("adds a language the round did not have", () => {
    const result = parseRoundForm(
      formFor(song, { "de.question": "Welcher Song ist das?", "de.answer": "Bohemian Rhapsody" }),
      song,
    );
    expect(result).toEqual({
      ok: true,
      changed: true,
      patch: { texts: { de: { question: "Welcher Song ist das?", answer: "Bohemian Rhapsody", aliases: [] } } },
    });
  });

  it("refuses a language left half written, and says which half", () => {
    expect(parseRoundForm(formFor(flag, { "de.answer": "" }), flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("German has a question but no answer"),
    });
    expect(parseRoundForm(formFor(flag, { "de.question": "" }), flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("German has an answer but no question"),
    });
    expect(
      parseRoundForm(formFor(song, { "de.aliases": "Queen" }), song),
    ).toMatchObject({ ok: false, error: expect.stringContaining("German has aliases but no answer") });
  });

  it("refuses to leave a round with no language at all", () => {
    const cleared = formFor(flag, {
      "en.question": "",
      "en.answer": "",
      "en.aliases": "",
      "de.question": "",
      "de.answer": "",
    });
    expect(parseRoundForm(cleared, flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("at least one language"),
    });
  });

  it("keeps a round on a shelf of its own kind", () => {
    expect(parseRoundForm(formFor(flag, { topic: "landmarks" }), flag)).toMatchObject({
      ok: true,
      patch: { topic: "landmarks" },
    });
    expect(parseRoundForm(formFor(flag, { topic: "music" }), flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Music deals lyrics"),
    });
    expect(parseRoundForm(formFor(song, { topic: "flags" }), song)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Flags deals pictures"),
    });
    expect(parseRoundForm(formFor(flag, { topic: "memes" }), flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("catalogue"),
    });
  });

  it("holds every field to the same limits as the fill tool", () => {
    expect(parseRoundForm(formFor(flag, { subject: "" }), flag)).toMatchObject({ ok: false });
    expect(
      parseRoundForm(formFor(flag, { "en.question": "x".repeat(QUESTION_MAX_LENGTH + 1) }), flag),
    ).toMatchObject({ ok: false, error: expect.stringContaining("question") });
    expect(
      parseRoundForm(formFor(flag, { "en.answer": "x".repeat(ANSWER_MAX_LENGTH + 1) }), flag),
    ).toMatchObject({ ok: false, error: expect.stringContaining("answer") });
    const many = Array.from({ length: MAX_ALIASES + 1 }, (_, index) => `alias ${index}`).join("\n");
    expect(parseRoundForm(formFor(flag, { "en.aliases": many }), flag)).toMatchObject({
      ok: false,
      error: expect.stringContaining("aliases"),
    });
  });

  it("edits a lyrics round's paraphrase, line ends and all, and its language tag", () => {
    const result = parseRoundForm(
      formFor(song, { snippet: "  Is any of this real, \r\n  or did I dream it?  \r\n\r\n", snippetLanguage: " EN-gb " }),
      song,
    );
    expect(result).toEqual({
      ok: true,
      changed: true,
      patch: { snippet: "Is any of this real,\nor did I dream it?", snippetLanguage: "en-gb" },
    });
    expect(parseRoundForm(formFor(song, { snippetLanguage: "" }), song)).toMatchObject({
      patch: { snippetLanguage: null },
    });
  });

  it("refuses a paraphrase that is missing, too long, or not a tag", () => {
    expect(parseRoundForm(formFor(song, { snippet: " \n " }), song)).toMatchObject({
      ok: false,
      error: expect.stringContaining("paraphrase"),
    });
    const tall = Array.from({ length: SNIPPET_MAX_LINES + 1 }, () => "la").join("\n");
    expect(parseRoundForm(formFor(song, { snippet: tall }), song)).toMatchObject({
      ok: false,
      error: expect.stringContaining("lines"),
    });
    expect(parseRoundForm(formFor(song, { snippetLanguage: "english" }), song)).toMatchObject({
      ok: false,
      error: expect.stringContaining("language tag"),
    });
  });

  /** A picture round has no paraphrase to validate, whatever the form carries. */
  it("ignores the snippet fields on a picture round", () => {
    expect(parseRoundForm(formFor(flag, { snippet: "", snippetLanguage: "nonsense" }), flag)).toEqual({
      ok: true,
      patch: {},
      changed: false,
    });
  });
});

describe("splitAliases", () => {
  it("is one per line, trimmed, unrepeated, and never the answer itself", () => {
    expect(splitAliases(" Queen \n\nqueen\nFreddie Mercury\nBohemian Rhapsody", "Bohemian Rhapsody")).toEqual([
      "Queen",
      "Freddie Mercury",
    ]);
    expect(splitAliases("", "x")).toEqual([]);
  });
});

describe("parseSourceUrl", () => {
  it("takes a web URL or nothing", () => {
    expect(parseSourceUrl("  ")).toBeNull();
    expect(parseSourceUrl("https://commons.wikimedia.org/wiki/File:X.png")).toBe(
      "https://commons.wikimedia.org/wiki/File:X.png",
    );
    expect(parseSourceUrl("commons.wikimedia.org")).toMatchObject({ error: expect.any(String) });
    expect(parseSourceUrl("javascript:alert(1)")).toMatchObject({ error: expect.any(String) });
  });
});
