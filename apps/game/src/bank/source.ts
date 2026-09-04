import type { LanguageId } from "@guessly/protocol";
import {
  RoundSourceError,
  type RoundContentSource,
  type SourcedRound,
} from "../content/source.js";
import type { BankedRound, BankedRoundText, RoundRepository } from "@guessly/bank";

/**
 * The round bank: the `RoundContentSource` the game talks to — and the only
 * one. A build is answered from the bank in ~0ms or not at all: the server
 * makes no AI calls, so a topic whose shelf is empty in the lobby's language
 * fails the round, and the runner's own retry draws a fresh topic. Filling the
 * shelves is the fill tool's job (`pnpm fill`), where the generation can be
 * watched and paid for deliberately instead of in front of a countdown.
 *
 * **A round is banked in every language at once.** One picture, one row in
 * `rounds`, one `round_texts` row per language — so a German lobby and an
 * English one are dealt the same photograph with the question and the answer
 * each room can read. What a lobby is *shown* is its own language; what it is
 * allowed to *type* is every language the round holds, which is why
 * `toSourced` folds the others' answers into the alias list.
 */

export interface BankedRoundSourceOptions {
  repository: RoundRepository;
  /** Where a player's browser reaches this server, e.g. "http://localhost:3001". */
  publicBaseUrl: string;
  now?: () => number;
}

export function createBankedRoundSource(options: BankedRoundSourceOptions): RoundContentSource {
  const { repository } = options;
  const now = options.now ?? Date.now;
  const baseUrl = options.publicBaseUrl.replace(/\/+$/, "");

  const imageUrl = (filename: string): string => `${baseUrl}/img/${filename}`;

  /**
   * Everything a player may type and be right, gathered from every language
   * the round was written in.
   *
   * The lobby's own answer and aliases come first because they are the likely
   * ones; the rest follow because somebody in a German lobby will type
   * "France" and they will not be wrong about what is on the screen. Deduped
   * case-insensitively, since the languages agree far more often than not —
   * a song title is usually the same string in both.
   */
  const acceptedAliases = (
    texts: Partial<Record<LanguageId, BankedRoundText>>,
    language: LanguageId,
  ): string[] => {
    const own = texts[language];
    const seen = new Set<string>(own ? [own.answer.toLowerCase()] : []);
    const out: string[] = [];

    const add = (candidate: string): void => {
      const key = candidate.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(candidate);
    };

    for (const alias of own?.aliases ?? []) add(alias);
    for (const [id, text] of Object.entries(texts) as [LanguageId, BankedRoundText | undefined][]) {
      if (id === language || text === undefined) continue;
      add(text.answer);
      for (const alias of text.aliases) add(alias);
    }
    return out;
  };

  /**
   * One round, as the lobby that asked for it should see it. `texts[language]`
   * is guaranteed by the caller — the draw joins on the language, and `build`
   * refuses a round that came back without it.
   *
   * Only the question and the answer follow the room. The picture and the
   * paraphrase are the round, and the round is the same for everybody.
   */
  const toSourced = (banked: BankedRound, language: LanguageId): SourcedRound => {
    const text = banked.texts[language]!;
    return {
      content:
        banked.kind === "lyrics"
          ? {
              kind: "lyrics",
              question: text.question,
              snippet: banked.snippet ?? "",
              snippetLanguage: banked.snippetLanguage,
            }
          : {
              kind: "image",
              question: text.question,
              // A banked image round always has its file; the source host URL
              // is attribution, never something to send a player's browser to.
              imageUrl: banked.imageFile === null ? "" : imageUrl(banked.imageFile),
            },
      answer: text.answer,
      aliases: acceptedAliases(banked.texts, language),
      subject: banked.subject,
      // Carried through so a vote on this round lands on this row.
      id: banked.id,
    };
  };

  return {
    async build(request) {
      let banked: BankedRound | null = null;
      try {
        banked = await repository.draw(request.topic, request.language, request.exclude, now());
      } catch (error) {
        throw new RoundSourceError("The round bank could not be read.", {
          cause: error,
          detail: `draw failed for ${request.topic}/${request.language}`,
        });
      }

      // The draw joins on the language, so a round that came back without one
      // is a bank in a state it should not be in — served, it would be a round
      // with no question, which costs more than the miss does.
      if (!banked || !banked.texts[request.language]) {
        throw new RoundSourceError("This topic has no rounds stocked yet.", {
          detail: `the bank holds no unplayed ${request.topic} round in ${request.language} — run \`pnpm fill\` to stock it`,
        });
      }

      console.log(
        `[game] ${request.code} round ${request.number} (${request.topic}/${request.language}): "${banked.subject}" from the bank`,
      );
      return toSourced(banked, request.language);
    },
  };
}
