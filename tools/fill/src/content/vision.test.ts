import { describe, expect, it } from "vitest";
import {
  buildVisionPrompt,
  decide,
  namesAnswer,
  readVisionReply,
  svgVerdict,
  type JudgeContext,
  type VisionReport,
} from "./vision.js";

const context: JudgeContext = {
  subject: "Portal 2",
  question: "Which game is this?",
  answers: ["Portal 2", "Portal II", "Valve"],
};

const report = (overrides: Partial<VisionReport> = {}): VisionReport => ({
  text: "",
  showsSubject: true,
  givesAway: false,
  quality: "good",
  reason: "",
  ...overrides,
});

describe("namesAnswer", () => {
  it("finds the answer whole, whatever the case, accents or punctuation around it", () => {
    expect(namesAnswer("PORTAL 2 — coming soon", "Portal 2")).toBe(true);
    expect(namesAnswer("Café de Flore, Paris", "Cafe de Flore")).toBe(true);
    expect(namesAnswer("Straße", "Strasse")).toBe(true);
  });

  it("matches on word boundaries, so a short title is not found inside another word", () => {
    expect(namesAnswer("Upstairs, cup of tea", "Up")).toBe(false);
    expect(namesAnswer("Pixar's Up", "Up")).toBe(true);
    expect(namesAnswer("Nikon D850", "Nike")).toBe(false);
  });

  it("counts a multi-word answer whose distinctive words all appear in any order", () => {
    expect(namesAnswer("RHAPSODY — a BOHEMIAN night", "Bohemian Rhapsody")).toBe(true);
    // Short words do not count, or "Let It Be" would match any sentence in
    // English that happens to hold all three.
    expect(namesAnswer("be it known: let there be light", "Let It Be")).toBe(false);
  });

  it("never matches an empty answer against anything", () => {
    expect(namesAnswer("anything at all", "")).toBe(false);
    expect(namesAnswer("", "Portal 2")).toBe(false);
  });
});

describe("readVisionReply", () => {
  it("reads the object the model was asked for", () => {
    expect(
      readVisionReply(
        '{"text": "APERTURE", "shows_subject": true, "gives_away": false, "quality": "good", "reason": "A test chamber."}',
      ),
    ).toEqual({
      text: "APERTURE",
      showsSubject: true,
      givesAway: false,
      quality: "good",
      reason: "A test chamber.",
    });
  });

  it("finds the object inside a fence or a sentence, which is how the model sometimes replies", () => {
    const wrapped = 'Sure! ```json\n{"text": "", "shows_subject": false, "gives_away": false, "quality": "poor", "reason": "Menu."}\n```';
    expect(readVisionReply(wrapped)).toMatchObject({ showsSubject: false, quality: "poor" });
  });

  it("leaves a field it cannot read as unknown rather than guessing", () => {
    expect(readVisionReply('{"text": 5, "shows_subject": "yes", "quality": "great"}')).toEqual({
      text: "",
      showsSubject: null,
      givesAway: null,
      quality: null,
      reason: "",
    });
  });

  it("returns null for a reply with no object in it", () => {
    expect(readVisionReply("I cannot see the picture.")).toBeNull();
    expect(readVisionReply("{not json}")).toBeNull();
    expect(readVisionReply("[1, 2]")).toBeNull();
  });
});

describe("decide", () => {
  it("accepts a clean picture that shows the subject, verified", () => {
    expect(decide(report({ text: "APERTURE LABORATORIES" }), context)).toEqual({
      accepted: true,
      verified: true,
      note: null,
    });
  });

  it("rejects on the transcribed text naming an answer, even when the model said it gives nothing away", () => {
    const verdict = decide(report({ text: "PORTAL 2\nNow available", givesAway: false }), context);
    expect(verdict).toEqual({
      accepted: false,
      reason: 'the text "PORTAL 2 Now available" on it spells out "Portal 2"',
    });
  });

  it("rejects an alias on the picture as readily as the answer", () => {
    const verdict = decide(report({ text: "© Valve Corporation" }), context);
    expect(verdict).toMatchObject({ accepted: false, reason: expect.stringContaining('"Valve"') });
  });

  it("takes the model's word that something gives the answer away, with its reason", () => {
    const verdict = decide(
      report({ givesAway: true, reason: "The Aperture logo is the game's own mark." }),
      context,
    );
    expect(verdict).toEqual({
      accepted: false,
      reason: "it gives the answer away: The Aperture logo is the game's own mark.",
    });
  });

  it("rejects a picture that does not show the subject, and a poor one", () => {
    expect(decide(report({ showsSubject: false, reason: "A cat." }), context)).toEqual({
      accepted: false,
      reason: "it does not show Portal 2 plainly: A cat.",
    });
    expect(decide(report({ quality: "poor", reason: "A grid of thumbnails." }), context)).toEqual({
      accepted: false,
      reason: "it is a poor picture: A grid of thumbnails.",
    });
  });

  it("does not reject on a field the model left unknown", () => {
    expect(decide(report({ showsSubject: null, givesAway: null, quality: null }), context)).toMatchObject({
      accepted: true,
      verified: true,
    });
  });
});

describe("svgVerdict", () => {
  const svg = (body: string) =>
    new TextEncoder().encode(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);

  it("rejects an SVG whose rendered text spells the answer out", () => {
    const verdict = svgVerdict(
      svg('<rect/><text x="1" y="2"><tspan>Portal</tspan> <tspan>2</tspan></text>'),
      context,
    );
    expect(verdict).toMatchObject({ accepted: false, reason: expect.stringContaining('"Portal 2"') });
  });

  it("lets a clean SVG through, unverified and saying why", () => {
    expect(svgVerdict(svg('<text>Aperture</text><title>Portal 2</title>'), context)).toEqual({
      accepted: true,
      verified: false,
      note: "an SVG, which the vision model cannot read",
    });
  });
});

describe("buildVisionPrompt", () => {
  it("tells the model the subject, the question and every answer it must not find", () => {
    const prompt = buildVisionPrompt(context);
    expect(prompt).toContain("The subject is: Portal 2.");
    expect(prompt).toContain('"Which game is this?"');
    expect(prompt).toContain('"Portal 2", "Portal II", "Valve"');
    expect(prompt).toMatch(/JSON object and nothing else/);
  });
});
