import {
  GUESS_MAX_LENGTH,
  LANGUAGES,
  isTopicId,
  languageById,
  topicById,
  type LanguageId,
} from "@guessly/protocol";
import type { BankedRoundRecord, BankedRoundText, RoundPatch } from "@guessly/bank";

/**
 * Reading an edit off the form, and turning it into a patch that names only
 * what changed.
 *
 * Pure: a `FormData` and the round as it is now go in, a `RoundPatch` or one
 * sentence of refusal comes out. That is what lets "what counts as a valid
 * round" be argued in a test rather than in a server action — and it is the
 * same sentence the editor shows, so the test is reading what the operator
 * will read.
 *
 * The limits mirror the ones the fill tool's parser holds the model to
 * (tools/fill/src/content/schema.ts): an operator's round has to fit on the
 * same screen as the model's, and a question that scrolls is a round nobody
 * reads in twenty seconds.
 */

export const SUBJECT_MAX_LENGTH = 160;
export const QUESTION_MAX_LENGTH = 140;
/** What a player can type is what an answer may be. */
export const ANSWER_MAX_LENGTH = GUESS_MAX_LENGTH;
export const MAX_ALIASES = 12;
export const SNIPPET_MAX_LENGTH = 600;
export const SNIPPET_MAX_LINES = 8;

/** A BCP 47 tag, loosely: a language, and whatever subtags follow it. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

export type RoundFormResult =
  | { ok: true; patch: RoundPatch; changed: boolean }
  | { ok: false; error: string };

const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

/** A single-line field: inner runs of whitespace collapsed, ends trimmed. */
const line = (value: string): string => value.replace(/\s+/g, " ").trim();

/** A multi-line field: each line trimmed, blank ends dropped, Windows line ends folded. */
const lines = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((each) => each.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");

/**
 * The alias list as typed: one per line, blanks dropped, repeats folded
 * (case-insensitively, the way the bank keys answers) and the answer itself
 * left out — it is not also known as itself.
 */
export function splitAliases(text: string, answer: string): string[] {
  const seen = new Set<string>([answer.trim().toLowerCase()]);
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const alias = line(raw);
    const key = alias.toLowerCase();
    if (alias === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

const sameText = (a: BankedRoundText | null, b: BankedRoundText | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.question === b.question &&
    a.answer === b.answer &&
    a.aliases.length === b.aliases.length &&
    a.aliases.every((alias, index) => alias === b.aliases[index])
  );
};

/** One language's three fields, or null when both that matter were left blank. */
function parseText(form: FormData, language: LanguageId): BankedRoundText | null | string {
  const label = languageById(language).label;
  const question = line(field(form, `${language}.question`));
  const answer = line(field(form, `${language}.answer`));
  const aliasText = field(form, `${language}.aliases`);

  if (question === "" && answer === "") {
    // Nothing written in this language. Aliases with no answer to be aliases
    // of are a half-filled card, and that is worth saying rather than losing.
    if (line(aliasText) !== "") return `${label} has aliases but no answer for them to stand in for.`;
    return null;
  }
  if (question === "") return `${label} has an answer but no question to ask for it.`;
  if (answer === "") return `${label} has a question but no answer to it.`;
  if (question.length > QUESTION_MAX_LENGTH) {
    return `The ${label} question is ${question.length} characters; ${QUESTION_MAX_LENGTH} is the most that fits above a picture.`;
  }
  if (answer.length > ANSWER_MAX_LENGTH) {
    return `The ${label} answer is ${answer.length} characters; a player has ${ANSWER_MAX_LENGTH} to type.`;
  }

  const aliases = splitAliases(aliasText, answer);
  if (aliases.length > MAX_ALIASES) {
    return `${label} lists ${aliases.length} aliases; ${MAX_ALIASES} is plenty.`;
  }
  const long = aliases.find((alias) => alias.length > ANSWER_MAX_LENGTH);
  if (long !== undefined) return `The ${label} alias "${long}" is longer than anybody could type.`;

  return { question, answer, aliases };
}

export function parseRoundForm(form: FormData, current: BankedRoundRecord): RoundFormResult {
  const patch: RoundPatch = {};

  const subject = line(field(form, "subject"));
  if (subject === "") return { ok: false, error: "Every round needs a subject — what the picture or the song is." };
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return { ok: false, error: `The subject is ${subject.length} characters; ${SUBJECT_MAX_LENGTH} is the most the bank keeps.` };
  }
  if (subject !== current.subject) patch.subject = subject;

  const topic = line(field(form, "topic"));
  if (!isTopicId(topic)) return { ok: false, error: "Pick a topic from the catalogue." };
  if (topicById(topic).kind !== current.kind) {
    return {
      ok: false,
      error: `${topicById(topic).label} deals ${topicById(topic).kind === "lyrics" ? "lyrics" : "pictures"}, and this round is ${current.kind === "lyrics" ? "lyrics" : "a picture"}.`,
    };
  }
  if (topic !== current.topic) patch.topic = topic;

  if (current.kind === "lyrics") {
    const snippet = lines(field(form, "snippet"));
    if (snippet === "") return { ok: false, error: "A lyrics round needs its paraphrase — that is the whole round." };
    if (snippet.length > SNIPPET_MAX_LENGTH) {
      return { ok: false, error: `The paraphrase is ${snippet.length} characters; ${SNIPPET_MAX_LENGTH} is the most that fits on the stage.` };
    }
    const count = snippet.split("\n").filter((each) => each !== "").length;
    if (count > SNIPPET_MAX_LINES) {
      return { ok: false, error: `The paraphrase runs to ${count} lines; ${SNIPPET_MAX_LINES} is the most that fits on the stage.` };
    }
    if (snippet !== current.snippet) patch.snippet = snippet;

    const tagRaw = line(field(form, "snippetLanguage"));
    const snippetLanguage = tagRaw === "" ? null : tagRaw.toLowerCase();
    if (snippetLanguage !== null && !LANGUAGE_TAG.test(snippetLanguage)) {
      return { ok: false, error: `"${tagRaw}" is not a language tag. Use one like en, de or pt-BR — or leave it blank.` };
    }
    if (snippetLanguage !== current.snippetLanguage) patch.snippetLanguage = snippetLanguage;
  }

  let written = 0;
  for (const language of LANGUAGES) {
    const parsed = parseText(form, language.id);
    if (typeof parsed === "string") return { ok: false, error: parsed };
    if (parsed !== null) written += 1;
    const before = current.texts[language.id] ?? null;
    if (!sameText(before, parsed)) (patch.texts ??= {})[language.id] = parsed;
  }
  if (written === 0) {
    return { ok: false, error: "A round needs at least one language, or no lobby could ever be dealt it." };
  }

  return { ok: true, patch, changed: Object.keys(patch).length > 0 };
}

/**
 * The optional attribution beside a replaced picture: an https URL or
 * nothing. Returned as a sentence when it is neither, like everything above.
 */
export function parseSourceUrl(value: string): string | null | { error: string } {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { error: "The source has to be a full URL, or left blank." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "The source has to be an http or https URL, or left blank." };
  }
  return url.toString();
}
