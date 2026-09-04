import { isLanguageId, isTopicId, type LanguageId } from "@guessly/protocol";
import type { RoundFilter } from "@guessly/bank";

/**
 * The round list's address: what `/rounds?…` means, and how to write it.
 *
 * The filter lives in the URL rather than in state so a page of rounds is a
 * link — to paste, to bookmark, to come back to after an edit — and so the
 * filter form can be a plain GET form: its selects need a script to open,
 * but the submission is the browser's and the result is an address.
 * Reading and writing it are in one file so they cannot disagree about a
 * parameter's name. A value that is not a real id is read as no filter,
 * which is what lets the form send a word for "any".
 */

export const ROUNDS_PER_PAGE = 24;

export interface RoundQuery {
  filter: RoundFilter;
  /** 1-based. */
  page: number;
}

/**
 * The language filter as one parameter, because it is one question with
 * four answers: written in a language, or missing one.
 */
export type LanguageChoice = `${LanguageId}` | `missing:${LanguageId}`;

type Params = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** The URL's answer to the language question, or null for "any". */
export function languageChoice(filter: RoundFilter): LanguageChoice | null {
  if (filter.language !== undefined) return filter.language;
  if (filter.missingLanguage !== undefined) return `missing:${filter.missingLanguage}`;
  return null;
}

export function parseRoundQuery(params: Params): RoundQuery {
  const filter: RoundFilter = {};

  const topic = first(params.topic);
  if (isTopicId(topic)) filter.topic = topic;

  const kind = first(params.kind);
  if (kind === "image" || kind === "lyrics") filter.kind = kind;

  const language = first(params.language);
  if (isLanguageId(language)) filter.language = language;
  else if (language.startsWith("missing:") && isLanguageId(language.slice("missing:".length))) {
    filter.missingLanguage = language.slice("missing:".length) as LanguageId;
  }

  const search = first(params.q).trim();
  if (search !== "") filter.search = search;

  const page = Number(first(params.page));
  return { filter, page: Number.isInteger(page) && page >= 1 ? page : 1 };
}

/** `/rounds?…` for this query — the same address `parseRoundQuery` reads. */
export function roundsHref(query: RoundQuery): string {
  const params = new URLSearchParams();
  if (query.filter.topic !== undefined) params.set("topic", query.filter.topic);
  if (query.filter.kind !== undefined) params.set("kind", query.filter.kind);
  const language = languageChoice(query.filter);
  if (language !== null) params.set("language", language);
  if (query.filter.search !== undefined) params.set("q", query.filter.search);
  if (query.page > 1) params.set("page", String(query.page));
  const encoded = params.toString();
  return encoded === "" ? "/rounds" : `/rounds?${encoded}`;
}

/** Is anything narrowed at all? Decides whether a "Clear" link is worth showing. */
export const isFiltered = (filter: RoundFilter): boolean => Object.keys(filter).length > 0;
