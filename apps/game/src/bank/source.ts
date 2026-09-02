import {
  ALL_LANGUAGE_IDS,
  topicById,
  type LanguageId,
  type TopicId,
} from "@guessly/protocol";
import type {
  GeneratedRound,
  GeneratedTexts,
  RoundContentSource,
  RoundGenerator,
  SourcedRound,
} from "../content/source.js";
import type { ImageStore } from "./images.js";
import type { BankedRound, NewBankedRound, RoundRepository } from "./repository.js";

/**
 * The round bank: the `RoundContentSource` the game actually talks to.
 *
 * A build is answered from the bank when the bank has a fitting round — that is
 * the ~0ms path, and the whole point — and by the generator when it does not,
 * in which case the fresh round is banked on its way out so the same work is
 * never paid for twice. Every draw that leaves a topic's shelf low kicks a
 * background top-up, so the pool fills *because* the game is being played and
 * the generator drifts to where the players' latency is not.
 *
 * **A round is banked in every language at once.** The generator is asked for
 * all of them in one call, and the one picture is downloaded and stored once,
 * so a German lobby and an English one are dealt the same photograph with the
 * question and the answer each room can read. What a lobby is *shown* is its
 * own language; what it is allowed to *type* is every language the round holds,
 * which is why `toSourced` folds the others' answers into the alias list.
 *
 * The bank is an optimisation with a database, never a new way to fail: a draw
 * that errors falls through to the generator, a round that cannot be banked is
 * still served, and an image that cannot be stored is served from the host it
 * was downloaded from. The one thing that stops a round here is the one thing
 * that always could — the generator coming up empty on a cold topic.
 */

/**
 * Below this many banked rounds, a topic gets a background top-up after a
 * draw. High enough that one game rarely bottoms a topic out, low enough that
 * an idle server is not quietly spending money on a fuller larder than anyone
 * has asked for. Filling happens one round per topic at a time, for the same
 * reason — and one round means one round in every language, so the gauge is
 * read against the language that was just drawn.
 */
const DEFAULT_LOW_WATER = 8;

export interface BankedRoundSourceOptions {
  repository: RoundRepository;
  images: ImageStore;
  generator: RoundGenerator;
  /** Where a player's browser reaches this server, e.g. "http://localhost:3001". */
  publicBaseUrl: string;
  lowWater?: number;
  /** Which languages a fresh round is written in. The whole catalogue, in practice. */
  languages?: readonly LanguageId[];
  now?: () => number;
}

export interface BankedRoundSource extends RoundContentSource {
  /** Waits for in-flight background top-ups. For shutdown, and for tests. */
  drain(): Promise<void>;
  /** Stops background work and drains it. The repositories close elsewhere. */
  close(): Promise<void>;
}

export function createBankedRoundSource(options: BankedRoundSourceOptions): BankedRoundSource {
  const { repository, images, generator } = options;
  const lowWater = options.lowWater ?? DEFAULT_LOW_WATER;
  const languages = options.languages ?? ALL_LANGUAGE_IDS;
  const now = options.now ?? Date.now;
  const baseUrl = options.publicBaseUrl.replace(/\/+$/, "");

  /** Aborts background generation on close; game builds carry their own signal. */
  const background = new AbortController();
  /** One top-up per topic at a time; a second trigger while one runs is a no-op. */
  const refilling = new Set<TopicId>();
  const pending = new Set<Promise<void>>();

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
  const acceptedAliases = (texts: GeneratedTexts, language: LanguageId): string[] => {
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
    for (const [id, text] of Object.entries(texts) as [LanguageId, GeneratedTexts[LanguageId]][]) {
      if (id === language || text === undefined) continue;
      add(text.answer);
      for (const alias of text.aliases) add(alias);
    }
    return out;
  };

  /**
   * One round, as the lobby that asked for it should see it. `texts[language]`
   * is guaranteed by whoever called — the draw joins on it, and the parser
   * refuses a generated round missing a language it was asked for.
   *
   * Only the question and the answer follow the room. The picture and the
   * paraphrase are the round, and the round is the same for everybody.
   */
  const toSourced = (
    round: {
      kind: "image" | "lyrics";
      subject: string;
      snippet: string | null;
      snippetLanguage: string | null;
      texts: GeneratedTexts;
    },
    language: LanguageId,
    servedImageUrl: string | null,
  ): SourcedRound => {
    const text = round.texts[language]!;
    return {
      content:
        round.kind === "lyrics"
          ? {
              kind: "lyrics",
              question: text.question,
              snippet: round.snippet ?? "",
              snippetLanguage: round.snippetLanguage,
            }
          : { kind: "image", question: text.question, imageUrl: servedImageUrl ?? "" },
      answer: text.answer,
      aliases: acceptedAliases(round.texts, language),
      subject: round.subject,
    };
  };

  /**
   * Stores a fresh round's image and banks the round. Returns the URL the
   * players should load the image from — our own origin when the store took
   * it, the source host when it would not, because a round in hand beats a
   * clean pantry.
   */
  const ingest = async (
    topic: TopicId,
    generated: GeneratedRound,
    served: boolean,
  ): Promise<string | null> => {
    let imageFile: string | null = null;
    if (generated.kind === "image") {
      try {
        imageFile = await images.save(generated.image);
      } catch (error) {
        console.error(`[bank] ${topic}: could not store the image; serving it from the source host`, error);
        return generated.image.sourceUrl;
      }
    }

    const round: NewBankedRound = {
      topic,
      kind: generated.kind,
      subject: generated.subject,
      imageFile,
      sourceUrl: generated.kind === "image" ? generated.image.sourceUrl : null,
      snippet: generated.kind === "lyrics" ? generated.snippet : null,
      snippetLanguage: generated.kind === "lyrics" ? generated.snippetLanguage : null,
      texts: generated.texts,
    };

    try {
      const inserted = await repository.insert(round, now(), served);
      if (!inserted) {
        console.log(`[bank] ${topic}: "${generated.subject}" is already banked; not stored twice`);
      }
    } catch (error) {
      console.error(`[bank] ${topic}: could not bank the round; serving it anyway`, error);
    }

    return imageFile === null ? null : imageUrl(imageFile);
  };

  /**
   * Refills one round for a topic sitting below the low-water mark.
   *
   * Keyed by topic and not by topic-and-language, because one generated round
   * fills every language at once: two top-ups for the same topic in different
   * languages would be the same work done twice. The *gauge* is the language
   * that was drawn, though — a topic full of rounds none of which were written
   * in German is an empty shelf to a German lobby.
   */
  const topUpIfLow = (topic: TopicId, language: LanguageId): void => {
    if (background.signal.aborted || refilling.has(topic)) return;
    refilling.add(topic);

    const task = (async () => {
      try {
        const stocked = await repository.count(topic, language);
        if (stocked >= lowWater) return;

        // The topic's own answers are the exclusion list, in every language:
        // the point of a top-up is a subject the shelf does not already hold,
        // and it holds it whichever language it was written in.
        const exclude = await repository.answers(topic);
        const generated = await generator.generate(
          { topic, kind: topicById(topic).kind, languages, number: stocked + 1, exclude },
          background.signal,
        );
        await ingest(topic, generated, false);
        console.log(
          `[bank] ${topic}: topped up with "${generated.subject}" (${stocked + 1}/${lowWater} in ${language})`,
        );
      } catch (error) {
        if (!background.signal.aborted) {
          console.warn(`[bank] ${topic}: top-up failed`, error);
        }
      } finally {
        refilling.delete(topic);
      }
    })();

    pending.add(task);
    void task.finally(() => pending.delete(task));
  };

  const drain = async (): Promise<void> => {
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
  };

  return {
    async build(request, signal) {
      let banked: BankedRound | null = null;
      try {
        banked = await repository.draw(request.topic, request.language, request.exclude, now());
      } catch (error) {
        // The generator can still save the round; the bank being broken is
        // the operator's problem and the log's, not the lobby's.
        console.error(`[bank] draw failed for ${request.topic}; generating instead`, error);
      }

      // The draw joins on the language, so a round that came back without one
      // is a bank in a state it should not be in — falling through costs a
      // generation, and serving a round with no question would cost the round.
      if (banked && banked.texts[request.language]) {
        console.log(
          `[game] ${request.code} round ${request.number} (${request.topic}/${request.language}): "${banked.subject}" from the bank`,
        );
        topUpIfLow(request.topic, request.language);
        return toSourced(
          {
            kind: banked.kind,
            subject: banked.subject,
            snippet: banked.snippet,
            snippetLanguage: banked.snippetLanguage,
            texts: banked.texts,
          },
          request.language,
          banked.imageFile === null ? null : imageUrl(banked.imageFile),
        );
      }

      const generated = await generator.generate(
        {
          topic: request.topic,
          kind: request.kind,
          // Every language, not just the one waiting: the picture and the
          // search are already paid for, and the next lobby to play in the
          // other one is then a bank hit rather than another three seconds.
          languages,
          number: request.number,
          exclude: request.exclude,
        },
        signal,
      );
      const servedImageUrl = await ingest(request.topic, generated, true);
      return toSourced(
        {
          ...generated,
          snippet: generated.kind === "lyrics" ? generated.snippet : null,
          snippetLanguage: generated.kind === "lyrics" ? generated.snippetLanguage : null,
        },
        request.language,
        servedImageUrl,
      );
    },

    drain,

    async close() {
      background.abort();
      await drain();
    },
  };
}
