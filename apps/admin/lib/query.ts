import { isLanguageId, isTopicId, type LanguageId } from "@guessly/protocol";
import type { RoundFilter, RoundOrder } from "@guessly/bank";

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
 *
 * `order` rides in the same address and is the one parameter that narrows
 * nothing: it is the same list read from a different end, and an address
 * without it is the plain list, newest first.
 */

export const ROUNDS_PER_PAGE = 24;

/** Every way the list can be read, in the order the filter offers them. */
export const ROUND_ORDERS = ["newest", "liked", "disliked"] as const satisfies readonly RoundOrder[];

export const DEFAULT_ORDER: RoundOrder = "newest";

export interface RoundQuery {
  filter: RoundFilter;
  order: RoundOrder;
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

const isRoundOrder = (value: string): value is RoundOrder =>
  (ROUND_ORDERS as readonly string[]).includes(value);

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

  const order = first(params.order);
  const page = Number(first(params.page));
  return {
    filter,
    order: isRoundOrder(order) ? order : DEFAULT_ORDER,
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** `/rounds?…` for this query — the same address `parseRoundQuery` reads. */
export function roundsHref(query: RoundQuery): string {
  const params = new URLSearchParams();
  if (query.filter.topic !== undefined) params.set("topic", query.filter.topic);
  if (query.filter.kind !== undefined) params.set("kind", query.filter.kind);
  const language = languageChoice(query.filter);
  if (language !== null) params.set("language", language);
  if (query.filter.search !== undefined) params.set("q", query.filter.search);
  if (query.order !== DEFAULT_ORDER) params.set("order", query.order);
  if (query.page > 1) params.set("page", String(query.page));
  const encoded = params.toString();
  return encoded === "" ? "/rounds" : `/rounds?${encoded}`;
}

/**
 * Does the filter leave anything out? The list reads this to tell an empty
 * page from an empty bank; an order is not a filter and is not counted.
 */
export const isFiltered = (filter: RoundFilter): boolean => Object.keys(filter).length > 0;

/** Is the address anything but the plain list? Decides whether "Clear" is worth showing. */
export const isNarrowed = (query: RoundQuery): boolean =>
  isFiltered(query.filter) || query.order !== DEFAULT_ORDER;
