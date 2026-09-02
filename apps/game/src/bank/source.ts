import { topicById, type TopicId } from "@guessly/protocol";
import type {
  GeneratedRound,
  RoundContentSource,
  RoundGenerator,
  SourcedRound,
} from "../content/source.js";
import type { ImageStore } from "./images.js";
import type { NewBankedRound, RoundRepository } from "./repository.js";

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
 * reason.
 */
const DEFAULT_LOW_WATER = 8;

export interface BankedRoundSourceOptions {
  repository: RoundRepository;
  images: ImageStore;
  generator: RoundGenerator;
  /** Where a player's browser reaches this server, e.g. "http://localhost:3001". */
  publicBaseUrl: string;
  lowWater?: number;
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
  const now = options.now ?? Date.now;
  const baseUrl = options.publicBaseUrl.replace(/\/+$/, "");

  /** Aborts background generation on close; game builds carry their own signal. */
  const background = new AbortController();
  /** One top-up per topic at a time; a second trigger while one runs is a no-op. */
  const refilling = new Set<TopicId>();
  const pending = new Set<Promise<void>>();

  const imageUrl = (filename: string): string => `${baseUrl}/img/${filename}`;

  const toSourced = (round: {
    kind: "image" | "lyrics";
    question: string;
    answer: string;
    aliases: string[];
    subject: string;
    snippet: string | null;
    servedImageUrl: string | null;
  }): SourcedRound => ({
    content:
      round.kind === "lyrics"
        ? { kind: "lyrics", question: round.question, snippet: round.snippet ?? "" }
        : { kind: "image", question: round.question, imageUrl: round.servedImageUrl ?? "" },
    answer: round.answer,
    aliases: round.aliases,
    subject: round.subject,
  });

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
      question: generated.question,
      answer: generated.answer,
      aliases: generated.aliases,
      subject: generated.subject,
      snippet: generated.kind === "lyrics" ? generated.snippet : null,
      imageFile,
      sourceUrl: generated.kind === "image" ? generated.image.sourceUrl : null,
    };

    try {
      const inserted = await repository.insert(round, now(), served);
      if (!inserted) {
        console.log(`[bank] ${topic}: "${generated.answer}" is already banked; not stored twice`);
      }
    } catch (error) {
      console.error(`[bank] ${topic}: could not bank the round; serving it anyway`, error);
    }

    return imageFile === null ? null : imageUrl(imageFile);
  };

  /** Refills one round for a topic sitting below the low-water mark. */
  const topUpIfLow = (topic: TopicId): void => {
    if (background.signal.aborted || refilling.has(topic)) return;
    refilling.add(topic);

    const task = (async () => {
      try {
        const stocked = await repository.count(topic);
        if (stocked >= lowWater) return;

        // The bank's own answers are the exclusion list: the point of a
        // top-up is a round the shelf does not already hold.
        const exclude = await repository.answers(topic);
        const generated = await generator.generate(
          { topic, kind: topicById(topic).kind, number: stocked + 1, exclude },
          background.signal,
        );
        await ingest(topic, generated, false);
        console.log(
          `[bank] ${topic}: topped up with "${generated.answer}" (${stocked + 1}/${lowWater})`,
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
      let banked = null;
      try {
        banked = await repository.draw(request.topic, request.exclude, now());
      } catch (error) {
        // The generator can still save the round; the bank being broken is
        // the operator's problem and the log's, not the lobby's.
        console.error(`[bank] draw failed for ${request.topic}; generating instead`, error);
      }

      if (banked) {
        console.log(
          `[game] ${request.code} round ${request.number} (${request.topic}): "${banked.subject}" from the bank`,
        );
        topUpIfLow(request.topic);
        return toSourced({
          ...banked,
          servedImageUrl: banked.imageFile === null ? null : imageUrl(banked.imageFile),
        });
      }

      const generated = await generator.generate(request, signal);
      const servedImageUrl = await ingest(request.topic, generated, true);
      return toSourced({
        ...generated,
        snippet: generated.kind === "lyrics" ? generated.snippet : null,
        servedImageUrl,
      });
    },

    drain,

    async close() {
      background.abort();
      await drain();
    },
  };
}
