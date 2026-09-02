/**
 * The language a round is written in.
 *
 * This is the *content* language, not the interface's: the question, the
 * answer, the aliases it will be matched against and a lyrics round's
 * paraphrase all come back in it, and the game's own chrome stays as it is.
 * That is the whole distinction — a German lobby answers "Frankreich", and
 * "France" is at best an alias somebody thought to include.
 *
 * A table rather than a pair of strings for the same reason as the topic
 * catalogue: the ids are wire format and must never change, the labels are
 * copy, and `tag` is a third thing again — a BCP 47 tag, so the UI can mark
 * content that is genuinely in another language as being in it rather than
 * leaving a screen reader to read German with an English voice.
 */

export interface LanguageDefinition {
  /** Wire format. Stable forever. */
  id: string;
  /** In English, because that is what the interface is in. */
  label: string;
  /** What its own speakers call it, shown beside the label. */
  endonym: string;
  /** BCP 47, for the `lang` attribute on anything rendered in this language. */
  tag: string;
}

export const LANGUAGES = [
  { id: "en", label: "English", endonym: "English", tag: "en" },
  { id: "de", label: "German", endonym: "Deutsch", tag: "de" },
] as const satisfies readonly LanguageDefinition[];

export type LanguageId = (typeof LANGUAGES)[number]["id"];

/** Catalogue order, which is also the order the selector renders in. */
export const ALL_LANGUAGE_IDS: readonly LanguageId[] = LANGUAGES.map((language) => language.id);

/**
 * What a lobby opens on. English rather than the browser's language: the
 * setting is the host's to make out loud in front of everybody, and a lobby
 * that quietly picked a language from whoever happened to create it would put
 * four people into a game the fifth cannot read.
 */
export const DEFAULT_LANGUAGE: LanguageId = "en";

const KNOWN_LANGUAGE_IDS: ReadonlySet<string> = new Set<string>(ALL_LANGUAGE_IDS);

export const isLanguageId = (value: unknown): value is LanguageId =>
  typeof value === "string" && KNOWN_LANGUAGE_IDS.has(value);

/** Total by construction — built from the array `LanguageId` is derived from. */
const LANGUAGES_BY_ID = Object.fromEntries(
  LANGUAGES.map((language) => [language.id, language]),
) as Record<LanguageId, LanguageDefinition>;

export const languageById = (id: LanguageId): LanguageDefinition => LANGUAGES_BY_ID[id];
