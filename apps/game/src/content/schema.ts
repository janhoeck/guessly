import { ALL_LANGUAGE_IDS, isLanguageId, type LanguageId, type RoundKind } from "@guessly/protocol";

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
 *
 * One submission carries **every language the round was asked for**. The
 * subject, the picture and a lyrics round's paraphrase are shared — they are
 * the same round — and `versions` is the part that differs. That shape is why
 * adding a language is an entry in the catalogue rather than a second call, a
 * second search and a second copy of the same photograph.
 *
 * The paraphrase sits at the top level with the picture rather than inside
 * `versions`, and that placement is the rule: it is written in the *song's*
 * language, so there is exactly one of it and no room can be handed a
 * translated one.
 */

export const SUBMIT_ROUND_TOOL_NAME = "submit_round";

/**
 * Every field is required, because `strict` requires it. The two kind-specific
 * fields are therefore always present and the *unused* one is empty — which is
 * simpler to satisfy, and simpler to check, than a schema that tries to be
 * conditional.
 *
 * The language enum is built from the catalogue, so a new language is one entry
 * in `packages/protocol/src/languages.ts` and nothing here.
 */
export const SUBMIT_ROUND_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    subject: {
      type: "string",
      description:
        "The thing you picked, named plainly for the server log. Not shown to players.",
    },
    image_urls: {
      type: "array",
      items: { type: "string" },
      description:
        "Image rounds only. Three to five direct https URLs to an image file, best first, each one seen in a search result rather than written from memory, on hosts that serve files to anyone. Empty array on a lyrics round.",
    },
    lyrics_snippet: {
      type: "string",
      description:
        "Lyrics rounds only. Three to five newline-separated lines paraphrasing the song in your own words, written in the language the song is sung in — never real lyrics, and never the title. One paraphrase for every room. Empty string on an image round.",
    },
    lyrics_language: {
      type: "string",
      description:
        "Lyrics rounds only. The language code of the song, and so of the paraphrase above: 'en' for an English song, 'de' for a German one, 'es' for a Spanish one. Empty string on an image round.",
    },
    versions: {
      type: "array",
      description:
        "One entry per language you were asked for — all of them, none left out, none added. The same subject and the same picture each time; only the words change.",
      items: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: [...ALL_LANGUAGE_IDS],
            description: "Which language this entry is written in.",
          },
          question: {
            type: "string",
            description:
              "The one line shown above the content telling players what to name — \"Which country's flag is this?\", \"Wer singt das?\". Under about ten words, asks for exactly one thing, and never contains the answer.",
          },
          answer: {
            type: "string",
            description:
              "The shortest thing a player of this language would actually type. 'Bhutan', not 'the flag of the Kingdom of Bhutan'.",
          },
          aliases: {
            type: "array",
            items: { type: "string" },
            description:
              "Everything else this language should count as correct: spellings, abbreviations, the local name, the artist for a song. Five to ten. Never repeat the answer itself.",
          },
        },
        required: ["language", "question", "answer", "aliases"],
        additionalProperties: false,
      },
    },
  },
  required: ["subject", "image_urls", "lyrics_snippet", "lyrics_language", "versions"],
  additionalProperties: false,
};

/** A guessable answer is short. Anything longer is a description, not an answer. */
const ANSWER_MAX_LENGTH = 80;
/** One line above the content. Longer than this and it is a paragraph. */
const QUESTION_MAX_LENGTH = 140;
const SUBJECT_MAX_LENGTH = 160;
const MAX_ALIASES = 12;
/** Five since the bank: every extra candidate is another chance the download
 *  pipeline saves the round, and the failed ones cost one request each. */
const MAX_IMAGE_URLS = 5;
/** Long enough for five lines of paraphrase, short enough not to be a lyric sheet. */
const SNIPPET_MAX_LENGTH = 600;
const SNIPPET_MIN_LENGTH = 20;
const SNIPPET_MAX_LINES = 8;

/**
 * Shaped like a BCP 47 tag, which is all that can be checked here — the song
 * may be in a language this game has never heard of, and refusing "cy" because
 * nobody plays in Welsh would throw away a perfectly good round. A tag that is
 * not even shaped right is dropped rather than rejected: the UI then marks the
 * snippet with no language at all, which is honest, where marking it with a
 * guess would not be.
 */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

const IMAGE_EXTENSION = /\.(jpe?g|png|webp|gif|svg)$/i;

/** One language's half of a submission, once it has survived the rules. */
export interface ParsedText {
  question: string;
  answer: string;
  aliases: string[];
}

export type ParsedTexts = Partial<Record<LanguageId, ParsedText>>;

export type ParsedSubmission =
  | { ok: true; kind: "image"; subject: string; imageUrls: string[]; texts: ParsedTexts }
  | {
      ok: true;
      kind: "lyrics";
      subject: string;
      /** One paraphrase, in the song's language, for every room. */
      snippet: string;
      /** Its BCP 47 tag, or null when what came back was not one. */
      snippetLanguage: string | null;
      texts: ParsedTexts;
    }
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

/**
 * One language's entry, judged on its own. The reason names the language,
 * because "the answer was empty" is not an actionable note when five of them
 * were submitted.
 */
function parseText(
  entry: Record<string, unknown>,
  language: LanguageId,
): ParsedText | { reason: string } {
  const named = (reason: string) => ({ reason: `for ${language}, ${reason}` });

  const answer = asTrimmedString(entry.answer);
  if (!answer) return named("the answer was empty.");
  if (answer.length > ANSWER_MAX_LENGTH) {
    return named(
      `the answer was ${answer.length} characters — it has to be short enough to type in a few seconds.`,
    );
  }

  const question = asTrimmedString(entry.question);
  if (!question) return named("the question was empty.");
  if (question.length > QUESTION_MAX_LENGTH) {
    return named("the question was too long — it is one short line above the content.");
  }
  // A question that names the answer is not a question. It is the cheapest
  // possible way to ruin a round, so it is checked rather than trusted.
  if (leaksAnswer(question, answer)) return named("the question gave the answer away.");

  return { question, answer, aliases: cleanAliases(asStringArray(entry.aliases), answer) };
}

/**
 * The paraphrase, judged once for the whole round.
 *
 * It is checked against *every* language's answer rather than one, because
 * there is a single snippet and each room is scored against its own words: a
 * paraphrase that gives the German answer away is a broken round for the
 * German lobbies whatever it does for the English ones.
 */
function parseSnippet(
  input: Record<string, unknown>,
  texts: ParsedTexts,
): { snippet: string; snippetLanguage: string | null } | { reason: string } {
  const snippet = asTrimmedString(input.lyrics_snippet);
  if (snippet.length < SNIPPET_MIN_LENGTH) {
    return { reason: "the lyrics snippet was empty or far too short." };
  }
  if (snippet.length > SNIPPET_MAX_LENGTH) {
    return { reason: "the lyrics snippet was too long — three to five short lines." };
  }
  if (snippet.split("\n").filter((line) => line.trim()).length > SNIPPET_MAX_LINES) {
    return { reason: "the lyrics snippet ran to too many lines." };
  }
  // The one rule the players would notice being broken: a paraphrase with the
  // title in it is not a round, it is the answer.
  for (const [language, text] of Object.entries(texts) as [LanguageId, ParsedText][]) {
    if (leaksAnswer(snippet, text.answer)) {
      return { reason: `the lyrics snippet gave the song away in ${language}.` };
    }
  }

  const tag = asTrimmedString(input.lyrics_language).toLowerCase();
  return { snippet, snippetLanguage: LANGUAGE_TAG.test(tag) ? tag : null };
}

export function parseSubmission(
  input: unknown,
  kind: RoundKind,
  languages: readonly LanguageId[],
): ParsedSubmission {
  if (!isRecord(input)) return reject("the tool input was not an object.");
  if (languages.length === 0) return reject("no languages were asked for.");

  const versions = Array.isArray(input.versions) ? input.versions : [];
  const texts: ParsedTexts = {};

  for (const entry of versions) {
    if (!isRecord(entry)) continue;
    const language = entry.language;
    // A language nobody asked for is dropped rather than rejected: it is
    // wasted work, not a broken round, and the missing-language check below is
    // the one that actually protects the lobby.
    if (!isLanguageId(language) || !languages.includes(language)) continue;
    if (texts[language] !== undefined) continue;

    const parsed = parseText(entry, language);
    if ("reason" in parsed) return reject(parsed.reason);
    texts[language] = parsed;
  }

  // Every language, every time. A round missing one is a round the lobbies
  // playing in it can never be dealt, and it would be banked looking perfectly
  // healthy — so it is refused here, where the reason can still be told to the
  // model, rather than discovered later as an empty shelf.
  const missing = languages.filter((language) => texts[language] === undefined);
  if (missing.length > 0) {
    return reject(
      `you did not submit a version for ${missing.join(" and ")}. Every language asked for needs its own entry in "versions".`,
    );
  }

  const subject =
    asTrimmedString(input.subject).slice(0, SUBJECT_MAX_LENGTH) ||
    texts[languages[0]!]!.answer;

  if (kind === "lyrics") {
    const paraphrase = parseSnippet(input, texts);
    if ("reason" in paraphrase) return reject(paraphrase.reason);
    return { ok: true, kind: "lyrics", subject, texts, ...paraphrase };
  }

  // Submitting nothing and submitting five unusable things are different
  // mistakes, and the reason is fed back to the model on the retry — so they
  // are told apart here rather than flattened into one unhelpful sentence.
  const rawUrls = asStringArray(input.image_urls);
  const imageUrls = cleanImageUrls(rawUrls);
  if (imageUrls.length === 0) {
    return reject(
      rawUrls.length === 0
        ? "you submitted an image round with no image URLs at all. Search for the picture, then submit the URLs you saw."
        : `none of the ${rawUrls.length} URLs you gave could be an image: they have to be https and point straight at an image file.`,
    );
  }
  return { ok: true, kind: "image", subject, imageUrls, texts };
}
