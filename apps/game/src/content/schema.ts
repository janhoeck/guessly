import type { RoundKind } from "@guessly/protocol";

/**
 * The output contract.
 *
 * Two layers, and both are load-bearing. The JSON Schema below is attached to a
 * `strict` tool, which is what makes the model's `input` structurally valid by
 * construction rather than by luck — there is no prose to scrape, no fenced
 * block to find, and no "sometimes it adds a preamble".
 *
 * `parseSubmission` is the second layer, and it exists because structurally
 * valid is not the same as usable: a schema can promise a string and still be
 * handed an empty one, a lyrics snippet with the title in it, or a URL that is
 * a search results page. Everything below the schema is a game rule, and a
 * round that breaks one is rejected and asked for again rather than put in
 * front of twelve people.
 */

export const SUBMIT_ROUND_TOOL_NAME = "submit_round";

/**
 * Every field is required, because `strict` requires it. The two kind-specific
 * fields are therefore always present and the *unused* one is empty — which is
 * simpler to satisfy, and simpler to check, than a schema that tries to be
 * conditional.
 */
export const SUBMIT_ROUND_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    subject: {
      type: "string",
      description:
        "The thing you picked, named plainly for the server log. Not shown to players.",
    },
    question: {
      type: "string",
      description:
        "The one line shown above the content telling players what to name — \"Which country's flag is this?\", \"Who sings this?\". Under about ten words, asks for exactly one thing, and never contains the answer.",
    },
    answer: {
      type: "string",
      description:
        "The shortest thing a player would actually type. 'Bhutan', not 'the flag of the Kingdom of Bhutan'.",
    },
    aliases: {
      type: "array",
      items: { type: "string" },
      description:
        "Everything else that should count as correct: spellings, abbreviations, the local name, the artist for a song. Five to ten. Never repeat the answer itself.",
    },
    image_urls: {
      type: "array",
      items: { type: "string" },
      description:
        "Image rounds only. Up to three direct https URLs to an image file, best first, on hosts that allow hotlinking. Empty array on a lyrics round.",
    },
    lyrics_snippet: {
      type: "string",
      description:
        "Lyrics rounds only. Three to five newline-separated lines paraphrasing the song in your own words — never real lyrics, and never the title. Empty string on an image round.",
    },
  },
  required: ["subject", "question", "answer", "aliases", "image_urls", "lyrics_snippet"],
  additionalProperties: false,
};

/** A guessable answer is short. Anything longer is a description, not an answer. */
const ANSWER_MAX_LENGTH = 80;
/** One line above the content. Longer than this and it is a paragraph. */
const QUESTION_MAX_LENGTH = 140;
const SUBJECT_MAX_LENGTH = 160;
const MAX_ALIASES = 12;
const MAX_IMAGE_URLS = 3;
/** Long enough for five lines of paraphrase, short enough not to be a lyric sheet. */
const SNIPPET_MAX_LENGTH = 600;
const SNIPPET_MIN_LENGTH = 20;
const SNIPPET_MAX_LINES = 8;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|svg)$/i;

interface Common {
  subject: string;
  question: string;
  answer: string;
  aliases: string[];
}

export type ParsedSubmission =
  | ({ ok: true; kind: "image"; imageUrls: string[] } & Common)
  | ({ ok: true; kind: "lyrics"; snippet: string } & Common)
  /** Fed back to the model on the retry, so it does not make the same mistake twice. */
  | { ok: false; reason: string };

const reject = (reason: string): ParsedSubmission => ({ ok: false, reason });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asTrimmedString).filter(Boolean) : [];

/**
 * Does this text give the answer away?
 *
 * The literal title is the obvious leak. The one that slips past a substring
 * check is the same words in a different order — "a rhapsody, bohemian and
 * long" hands over exactly as much as the title does — so for a multi-word
 * answer the distinctive words are counted too. Short words are ignored: "Let
 * It Be" would otherwise flag any sentence in English.
 */
function leaksAnswer(text: string, answer: string): boolean {
  const haystack = text.toLowerCase();
  const needle = answer.toLowerCase();
  if (haystack.includes(needle)) return true;

  const words = needle.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4);
  return words.length > 1 && words.every((word) => haystack.includes(word));
}

/**
 * Case-insensitive dedupe that keeps the first spelling of each. The answer is
 * dropped from its own alias list — the matcher will already be comparing
 * against it, and a duplicate there is just noise on every future comparison.
 */
function cleanAliases(raw: string[], answer: string): string[] {
  const seen = new Set<string>([answer.toLowerCase()]);
  const out: string[] = [];
  for (const alias of raw) {
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length === MAX_ALIASES) break;
  }
  return out;
}

/**
 * URLs are filtered rather than validated: a host that turns out to 404 is
 * caught by the reachability check later, so the only thing worth refusing here
 * is what obviously cannot be an image at all. Ones that look like an image file
 * are tried first, because they are the ones that usually are.
 */
function cleanImageUrls(raw: string[]): string[] {
  const seen = new Set<string>();
  const looksLikeAnImage: string[] = [];
  const rest: string[] = [];

  for (const candidate of raw) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    (IMAGE_EXTENSION.test(url.pathname) ? looksLikeAnImage : rest).push(url.href);
  }

  return [...looksLikeAnImage, ...rest].slice(0, MAX_IMAGE_URLS);
}

export function parseSubmission(input: unknown, kind: RoundKind): ParsedSubmission {
  if (!isRecord(input)) return reject("the tool input was not an object.");

  const subject = asTrimmedString(input.subject).slice(0, SUBJECT_MAX_LENGTH);
  const answer = asTrimmedString(input.answer);

  if (!answer) return reject("the answer was empty.");
  if (answer.length > ANSWER_MAX_LENGTH) {
    return reject(
      `the answer was ${answer.length} characters — it has to be short enough to type in a few seconds.`,
    );
  }

  const question = asTrimmedString(input.question);
  if (!question) return reject("the question was empty.");
  if (question.length > QUESTION_MAX_LENGTH) {
    return reject("the question was too long — it is one short line above the content.");
  }
  // A question that names the answer is not a question. It is the cheapest
  // possible way to ruin a round, so it is checked rather than trusted.
  if (leaksAnswer(question, answer)) {
    return reject("the question gave the answer away.");
  }

  const aliases = cleanAliases(asStringArray(input.aliases), answer);
  const common: Common = { subject: subject || answer, question, answer, aliases };

  if (kind === "lyrics") {
    const snippet = asTrimmedString(input.lyrics_snippet);
    if (snippet.length < SNIPPET_MIN_LENGTH) {
      return reject("the lyrics snippet was empty or far too short.");
    }
    if (snippet.length > SNIPPET_MAX_LENGTH) {
      return reject("the lyrics snippet was too long — three to five short lines.");
    }
    if (snippet.split("\n").filter((line) => line.trim()).length > SNIPPET_MAX_LINES) {
      return reject("the lyrics snippet ran to too many lines.");
    }
    // The one rule the players would notice being broken: a paraphrase with the
    // title in it is not a round, it is the answer.
    if (leaksAnswer(snippet, answer)) {
      return reject("the lyrics snippet gave the song away.");
    }
    return { ok: true, kind: "lyrics", snippet, ...common };
  }

  const imageUrls = cleanImageUrls(asStringArray(input.image_urls));
  if (imageUrls.length === 0) {
    return reject("no usable https image URL was returned.");
  }
  return { ok: true, kind: "image", imageUrls, ...common };
}
