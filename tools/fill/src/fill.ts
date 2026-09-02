import {
  ALL_LANGUAGE_IDS,
  ALL_TOPIC_IDS,
  topicById,
  type LanguageId,
  type TopicId,
} from "@guessly/protocol";
import type { ImageStore, NewBankedRound, RoundRepository } from "@guessly/bank";
import type { RoundGenerator } from "./content/source.js";

/**
 * The bank's production line, driven by the fill tool rather than by the game:
 * the server only ever *reads* the bank, and this is what writes it.
 *
 * One call to `fillOnce` is one generated round — which is one subject in
 * every language at once, so the thinnest *shelf* is measured per topic as the
 * lowest count across languages: a topic full of English rounds none of which
 * were written in German is, to a German lobby, an empty shelf, and filling it
 * tops up both languages in the same call.
 *
 * A topic whose generation fails is *benched* — skipped for a while, twice as
 * long on each consecutive failure — because the two ways a generation fails
 * repeatedly are a topic run dry and an API that is down, and neither gets
 * better by being hammered. A dry topic backs off out of the rotation while
 * the others keep filling; a dead API benches everything, and `fillOnce`
 * reports `resting` so the caller can sleep instead of spin. A success clears
 * the topic's slate.
 */

/** First bench after a failure. Doubles per consecutive failure, capped below. */
const BENCH_BASE_MS = 30_000;
/** A topic run dry checks back in this often, which is cheap enough forever. */
const BENCH_MAX_MS = 15 * 60_000;

/** How full each topic's shelf is, per language and at its thinnest. */
export interface Shelf {
  topic: TopicId;
  counts: Partial<Record<LanguageId, number>>;
  /** The lowest count across languages — what the next fill is measured by. */
  level: number;
}

export type FillOutcome =
  /** One round banked, in every language. `level` is the topic's new thinnest count. */
  | { kind: "filled"; topic: TopicId; subject: string; level: number }
  /** The generator repeated an answer the topic already holds; nothing banked. */
  | { kind: "duplicate"; topic: TopicId; subject: string; retryAt: number }
  | { kind: "failed"; topic: TopicId; error: unknown; retryAt: number }
  /** Every topic is benched. Nothing to do before `until`. */
  | { kind: "resting"; until: number };

export interface BankFillerOptions {
  repository: RoundRepository;
  images: ImageStore;
  generator: RoundGenerator;
  topics?: readonly TopicId[];
  languages?: readonly LanguageId[];
  now?: () => number;
}

export interface BankFiller {
  /** The whole stockroom at a glance, in catalogue order. */
  shelves(): Promise<Shelf[]>;
  /** Generates and banks one round for the thinnest eligible shelf. */
  fillOnce(signal: AbortSignal): Promise<FillOutcome>;
}

export function createBankFiller(options: BankFillerOptions): BankFiller {
  const { repository, images, generator } = options;
  const topics = options.topics ?? ALL_TOPIC_IDS;
  const languages = options.languages ?? ALL_LANGUAGE_IDS;
  const now = options.now ?? Date.now;

  const failures = new Map<TopicId, number>();
  const benchedUntil = new Map<TopicId, number>();

  const bench = (topic: TopicId): number => {
    const streak = (failures.get(topic) ?? 0) + 1;
    failures.set(topic, streak);
    const until = now() + Math.min(BENCH_BASE_MS * 2 ** (streak - 1), BENCH_MAX_MS);
    benchedUntil.set(topic, until);
    return until;
  };

  const shelves = async (): Promise<Shelf[]> => {
    const out: Shelf[] = [];
    for (const topic of topics) {
      const counts: Partial<Record<LanguageId, number>> = {};
      let level = Number.POSITIVE_INFINITY;
      for (const language of languages) {
        const count = await repository.count(topic, language);
        counts[language] = count;
        level = Math.min(level, count);
      }
      out.push({ topic, counts, level: Number.isFinite(level) ? level : 0 });
    }
    return out;
  };

  return {
    shelves,

    async fillOnce(signal) {
      const stock = await shelves();
      const eligible = stock.filter((shelf) => (benchedUntil.get(shelf.topic) ?? 0) <= now());
      if (eligible.length === 0) {
        return { kind: "resting", until: Math.min(...stock.map((s) => benchedUntil.get(s.topic) ?? 0)) };
      }

      // Thinnest first; the sort is stable, so equals stay in catalogue order.
      const pick = [...eligible].sort((a, b) => a.level - b.level)[0]!;
      const topic = pick.topic;

      try {
        // The topic's own answers are the exclusion list, in every language:
        // the point of a fill is a subject the shelf does not already hold,
        // and it holds it whichever language it was written in.
        const exclude = await repository.answers(topic);
        const generated = await generator.generate(
          { topic, kind: topicById(topic).kind, languages, number: pick.level + 1, exclude },
          signal,
        );

        // Unlike the old in-server bank, an image that cannot be stored fails
        // the fill: there is no lobby waiting to be served from the source
        // host, and a round the players could not load has no business banked.
        const round: NewBankedRound = {
          topic,
          kind: generated.kind,
          subject: generated.subject,
          imageFile: generated.kind === "image" ? await images.save(generated.image) : null,
          sourceUrl: generated.kind === "image" ? generated.image.sourceUrl : null,
          snippet: generated.kind === "lyrics" ? generated.snippet : null,
          snippetLanguage: generated.kind === "lyrics" ? generated.snippetLanguage : null,
          texts: generated.texts,
        };

        if (!(await repository.insert(round, now(), false))) {
          // The model ignored the exclusion list — a sign the topic may be
          // running dry, so it is benched like a failure rather than retried
          // into the same wall at full speed.
          return { kind: "duplicate", topic, subject: generated.subject, retryAt: bench(topic) };
        }

        failures.delete(topic);
        benchedUntil.delete(topic);
        return { kind: "filled", topic, subject: generated.subject, level: pick.level + 1 };
      } catch (error) {
        // A Ctrl+C mid-generation is the caller stopping, not the topic failing.
        if (signal.aborted) throw error;
        return { kind: "failed", topic, error, retryAt: bench(topic) };
      }
    },
  };
}
