import OpenAI from "openai";
import { dedupKey } from "./dedup.js";
import type { DownloadedImage } from "./download.js";

/**
 * Looking at the picture before it is banked.
 *
 * The generator chooses a picture by its file name, its size and its caption,
 * because that is all it can see — and the two rules that matter most are
 * about what is *in* the picture: that it shows the subject large and plain,
 * and that the answer is not written across it. A poster spells the title
 * out. A store screenshot has the logo composited into the corner. A flag
 * from an infographic has the country's name under it. None of that is in a
 * caption, and a round that hands players the answer is the one kind of
 * round worse than no round.
 *
 * So every download is shown to a vision model with the subject and the
 * answers, and asked for three things: the readable text, whether the
 * subject is plainly there, and whether anything gives it away. The decision
 * is then made *here*, not by the model — `decide` rejects on the model's
 * own verdict *and* on the text it transcribed naming an answer, because a
 * model asked "does this give it away?" is lenient about a title it has just
 * read, and a rule about text is cheaper to argue in a test than to ask.
 *
 * The check is a guard rather than a dependency. DeepSeek's vision endpoint
 * is experimental and the fill loop has to keep working the day it changes,
 * so a check that cannot be made — the model gone, the network down, a reply
 * that is not JSON — accepts the picture *unverified* with a warning in the
 * log, and `DEEPSEEK_VISION_MODEL=` turns it off on purpose. What it never
 * does is fail a round: a rejected picture is the next candidate's turn, and
 * a rejected last candidate is a retry note that says why.
 */

/** DeepSeek's vision endpoint, at the time of writing. */
export const DEFAULT_VISION_MODEL = "deepseek-v4-flash-vision-exp";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** One look at one picture. Nothing about it should take this long. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** The reply is a short JSON object; the transcribed text is the long part. */
const MAX_REPLY_TOKENS = 600;

/** The vision model reads raster; an SVG is text and is read as text below. */
const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export interface JudgeContext {
  /** The subject, named plainly. */
  subject: string;
  /** The question players will see above the picture. */
  question: string;
  /** Every answer and every alias, in every language — none of them may be readable. */
  answers: readonly string[];
}

export type Verdict =
  | {
      accepted: true;
      /** False when the picture was let through without being looked at. */
      verified: boolean;
      /** Why it was not looked at, for the log. Null when it was. */
      note: string | null;
    }
  | { accepted: false; reason: string };

export interface ImageJudge {
  judge(image: DownloadedImage, context: JudgeContext, signal: AbortSignal): Promise<Verdict>;
}

/** Accepts everything, unverified: what the generator runs with when the check is switched off. */
export const acceptAll: ImageJudge = {
  async judge() {
    return { accepted: true, verified: false, note: null };
  },
};

/** What the vision model is asked to report, as read back from its reply. */
export interface VisionReport {
  /** Every piece of readable text, transcribed. */
  text: string;
  showsSubject: boolean | null;
  givesAway: boolean | null;
  quality: "good" | "poor" | null;
  reason: string;
}

/**
 * Does the transcribed text name an answer?
 *
 * Folded the way the duplicate check folds a name — case, accents, ß,
 * punctuation, a leading article — and matched on word boundaries, because
 * "Up" is a film and "level up" on a screenshot is not its title. A
 * multi-word answer also counts when its distinctive words all appear in any
 * order: "RHAPSODY — BOHEMIAN" on a poster gives away exactly as much as the
 * title does. Short words are ignored there, or "Let It Be" would match any
 * sentence in English.
 */
export function namesAnswer(text: string, answer: string): boolean {
  const haystack = ` ${dedupKey(text)} `;
  const needle = dedupKey(answer);
  if (!needle) return false;
  if (haystack.includes(` ${needle} `)) return true;

  const words = needle.split(" ").filter((word) => word.length >= 4);
  return words.length > 1 && words.every((word) => haystack.includes(` ${word} `));
}

const asBoolean = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/**
 * The reply, read leniently. The model is asked for JSON and nothing else and
 * mostly complies; when it wraps the object in a sentence or a fence, the
 * first `{` to the last `}` is still the object. Null when there is nothing
 * to read, which the judge treats as "could not look" rather than "rejected".
 */
export function readVisionReply(reply: string): VisionReport | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const quality =
    record.quality === "good" || record.quality === "poor" ? record.quality : null;
  return {
    text: typeof record.text === "string" ? record.text.trim() : "",
    showsSubject: asBoolean(record.shows_subject),
    givesAway: asBoolean(record.gives_away),
    quality,
    reason: typeof record.reason === "string" ? record.reason.trim() : "",
  };
}

const quote = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat;
};

/**
 * The rule, applied to the report. Exported for its own test: this is where
 * "the model said it was fine" is overruled by the text it transcribed.
 */
export function decide(report: VisionReport, context: JudgeContext): Verdict {
  const because = report.reason ? `: ${report.reason}` : "";

  const named = context.answers.find((answer) => namesAnswer(report.text, answer));
  if (named !== undefined) {
    return {
      accepted: false,
      reason: `the text "${quote(report.text)}" on it spells out "${named}"`,
    };
  }
  if (report.givesAway === true) {
    return { accepted: false, reason: `it gives the answer away${because}` };
  }
  if (report.showsSubject === false) {
    return { accepted: false, reason: `it does not show ${context.subject} plainly${because}` };
  }
  if (report.quality === "poor") {
    return { accepted: false, reason: `it is a poor picture${because}` };
  }
  return { accepted: true, verified: true, note: null };
}

/**
 * An SVG cannot be shown to the model, but it can be read: whatever it would
 * render as text is inside `<text>` elements. A flag or a logo from the
 * archives usually arrives rasterised anyway (the FilePath URL asks for a
 * width), so this is for the ones the web hands over as source.
 */
export function svgVerdict(bytes: Uint8Array, context: JudgeContext): Verdict {
  const source = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const text = [...source.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => (match[1] ?? "").replace(/<[^>]*>/g, " "))
    .join(" ");
  const named = context.answers.find((answer) => namesAnswer(text, answer));
  if (named !== undefined) {
    return { accepted: false, reason: `the SVG's text "${quote(text)}" spells out "${named}"` };
  }
  return { accepted: true, verified: false, note: "an SVG, which the vision model cannot read" };
}

/** What the model is shown beside the picture. */
export function buildVisionPrompt(context: JudgeContext): string {
  const answers = context.answers.map((answer) => `"${answer}"`).join(", ");
  return [
    `This picture is about to be used in a guessing game. Players will see it under the question "${context.question}" and must type the answer. The subject is: ${context.subject}. Accepted answers: ${answers}.`,
    "Look at the picture and reply with a JSON object and nothing else:",
    '{"text": "<every piece of readable text in the picture, transcribed verbatim; \\"\\" if there is none>",',
    ' "shows_subject": <true if the subject is the main thing in the picture, large and plain; false if it is absent, tiny, or something else>,',
    ' "gives_away": <true if any readable text, logo, wordmark or caption tells players the answer or a distinctive part of it>,',
    ' "quality": "good" or "poor" — poor means blurry, tiny, a collage or grid of thumbnails, mostly watermark, a page screenshot rather than a picture, or box art / a poster / a title screen where a scene was wanted,',
    ' "reason": "<one short sentence>"}',
  ].join("\n");
}

export interface DeepSeekImageJudgeOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

/** The real thing: one request per picture, no streaming, no thinking. */
export function createDeepSeekImageJudge(options: DeepSeekImageJudgeOptions): ImageJudge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: DEEPSEEK_BASE_URL,
    timeout: timeoutMs,
    maxRetries: 1,
  });
  // DeepSeek's extension of the wire format; the V4 models think by default,
  // and a transcription does not need a think.
  const thinkingOff = { thinking: { type: "disabled" } };

  return {
    async judge(image, context, signal) {
      if (!RASTER_TYPES.has(image.contentType)) {
        return image.contentType === "image/svg+xml"
          ? svgVerdict(image.bytes, context)
          : { accepted: true, verified: false, note: `${image.contentType} cannot be shown to the vision model` };
      }

      try {
        const completion = await client.chat.completions.create(
          {
            model: options.model,
            max_tokens: MAX_REPLY_TOKENS,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: buildVisionPrompt(context) },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${image.contentType};base64,${image.bytes.toString("base64")}`,
                    },
                  },
                ],
              },
            ],
            ...thinkingOff,
          },
          { signal },
        );
        const reply = completion.choices[0]?.message.content ?? "";
        const report = readVisionReply(reply);
        if (!report) {
          return { accepted: true, verified: false, note: "the vision model's reply could not be read" };
        }
        return decide(report, context);
      } catch (error) {
        // A Ctrl+C is the caller stopping, not the check failing.
        if (signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return { accepted: true, verified: false, note: `the vision check failed: ${message}` };
      }
    },
  };
}
