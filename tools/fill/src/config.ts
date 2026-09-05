import { fileURLToPath } from "node:url";
import { readS3Config, type S3ImageStoreConfig } from "@guessly/bank";
import { ALL_TOPIC_IDS, isTopicId, type TopicId } from "@guessly/protocol";
import { REASONING_EFFORTS, type ReasoningEffort } from "./content/deepseek.js";
import { DEFAULT_VISION_MODEL } from "./content/vision.js";

/**
 * Read env files into `process.env`, if there are any: the tool's own
 * `tools/fill/.env` first, then `apps/game/.env` as a fallback — because the
 * key already lives there on most dev machines, and demanding a copy of a
 * secret is how two copies drift. `process.loadEnvFile` never overwrites a
 * variable that is already set, so the tool's own file wins over the game's,
 * and a real environment variable beats both — a deploy sets its variables
 * properly and ships no `.env` at all.
 *
 * Paths are resolved against this module rather than the working directory,
 * so the tool finds them whether it was started by turbo, from the repo root,
 * or by an editor's run button. `src/` and `dist/` are both one level under
 * the package, so the same relative path works before and after a build.
 */
export function loadEnvFile(): void {
  for (const relative of ["../.env", "../../../apps/game/.env"]) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    try {
      process.loadEnvFile(path);
    } catch (error) {
      // No file is the normal case. Anything else — unreadable, malformed —
      // is worth saying out loud, but what matters is whether the environment
      // ends up with enough in it, and loadFillConfig decides that.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[fill] ignoring ${path}:`, error);
      }
    }
  }
}

/** What the fill tool needs: the model, and where the bank it fills lives. */
export interface FillConfig {
  deepseekApiKey: string;
  deepseekModel: string;
  /** How hard the model thinks per round — the speed and spend dial. */
  deepseekReasoningEffort: ReasoningEffort;
  /** The Postgres the game server deals from — the bank this tool fills. */
  databaseUrl: string;
  /** The bucket the bank's pictures go in: the one the game server reads. */
  s3: S3ImageStoreConfig;
  /**
   * The whole-web image search (serper.dev), or null when it is not
   * configured — in which case the lookup is Wikimedia and Steam alone,
   * which is what it was before.
   */
  serperApiKey: string | null;
  /** The vision model every downloaded picture is shown to. Null switches the check off. */
  deepseekVisionModel: string | null;
}

/**
 * Overridable so a deploy can move off it without a release, but not something
 * to tune casually — the prompt in content/prompt.ts is written for a model
 * that follows a tool schema and writes image URLs from what it already knows.
 * The pro tier because filling is a deliberate, watched spend that values a
 * round that banks over one that comes back fast; `deepseek-v4-flash` is the
 * cheaper knob if the rejects in the log stay rare. (`deepseek-chat` is gone —
 * the V4 generation retired the alias.)
 */
const DEFAULT_MODEL = "deepseek-v4-pro";

/**
 * The V4 models think by default, at `high` effort — which is most of a
 * round's latency and cost, on a task whose quality is guarded by the
 * parser's retry loop rather than by the depth of the think. `low` is the
 * fill tool's default; `DEEPSEEK_REASONING_EFFORT` overrides it for anyone
 * watching the reject rate climb (`high`, `max`) or chasing raw throughput
 * (`none`).
 */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "low";

/**
 * Read once at start and throw on anything missing. The API key is required
 * *here* and not by the game server, because this is the only process that
 * talks to the model — a server with an empty bank serves misses, not
 * surprises.
 */
export function loadFillConfig(env: NodeJS.ProcessEnv = process.env): FillConfig {
  const deepseekApiKey = (env.DEEPSEEK_API_KEY ?? "").trim();
  if (!deepseekApiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is required — the fill tool generates rounds with DeepSeek. Copy tools/fill/.env.example to tools/fill/.env and set it.",
    );
  }

  const deepseekModel = (env.DEEPSEEK_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  const effortRaw = (env.DEEPSEEK_REASONING_EFFORT ?? "").trim();
  const deepseekReasoningEffort = (effortRaw || DEFAULT_REASONING_EFFORT) as ReasoningEffort;
  if (!REASONING_EFFORTS.includes(deepseekReasoningEffort)) {
    throw new Error(
      `DEEPSEEK_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(", ")} — got ${JSON.stringify(effortRaw)}.`,
    );
  }

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required — the Postgres the round bank lives in, the same one the game server reads. Copy tools/fill/.env.example to tools/fill/.env and set it.",
    );
  }

  // Must be the bucket the game server reads — filling any other one is
  // pouring water beside the glass. Same four variables, same function, and
  // apps/game/.env is on the fallback list above, so one set in one place is
  // enough locally.
  const s3 = readS3Config(env, "tools/fill");

  // Optional: the fill tool without it is the fill tool as it was, and the
  // start line says the web search is off.
  const serperApiKey = (env.SERPER_API_KEY ?? "").trim() || null;

  // Unset means the default; set and empty means off. The difference is
  // deliberate: an operator who wants no check says so in the file, and a
  // file that never mentions it gets the check.
  const visionRaw = env.DEEPSEEK_VISION_MODEL;
  const deepseekVisionModel =
    visionRaw === undefined ? DEFAULT_VISION_MODEL : visionRaw.trim() || null;

  return {
    deepseekApiKey,
    deepseekModel,
    deepseekReasoningEffort,
    databaseUrl,
    s3,
    serperApiKey,
    deepseekVisionModel,
  };
}

/** What the command line asked for, on top of what the environment holds. */
export interface FillArgs {
  /**
   * The shelves this run is confined to, in catalogue order — or null when
   * nothing was asked and the whole stockroom is in the rotation.
   */
  topics: readonly TopicId[] | null;
}

const USAGE = "usage: pnpm fill [-- --topic <id>[,<id>...] ...]";

/**
 * Read the command line: `pnpm fill -- --topic flags` fills one shelf and
 * leaves the rest alone. The loop, the gauge and the benching are the same,
 * over a shorter list — so the tool can top up the topic a lobby just failed
 * on without paying for the other shelves first, or stock a new topic on its own.
 * `--topic` may be repeated, or given a comma-separated list; the result is
 * deduplicated and put in catalogue order, the way a lobby's selection is.
 *
 * `--` is tolerated anywhere, because pnpm and turbo both use it as their
 * separator and whichever of them forwards it, it means nothing here.
 * Anything else the tool does not know is refused rather than ignored: a
 * typo that quietly filled every shelf would be an expensive way to find it.
 */
export function parseFillArgs(argv: readonly string[]): FillArgs {
  const picked = new Set<TopicId>();
  let asked = false;
  const rest = [...argv];
  while (rest.length > 0) {
    const arg = rest.shift()!;
    if (arg === "--") continue;

    let value: string | undefined;
    if (arg === "--topic") value = rest.shift();
    else if (arg.startsWith("--topic=")) value = arg.slice("--topic=".length);
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}. ${USAGE}`);

    const ids = (value ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (ids.length === 0 || value?.startsWith("-")) {
      throw new Error(`--topic needs a topic id — one of ${ALL_TOPIC_IDS.join(", ")}. ${USAGE}`);
    }
    for (const id of ids) {
      if (!isTopicId(id)) {
        throw new Error(
          `Unknown topic ${JSON.stringify(id)} — the catalogue has ${ALL_TOPIC_IDS.join(", ")}.`,
        );
      }
      picked.add(id);
    }
    asked = true;
  }
  return { topics: asked ? ALL_TOPIC_IDS.filter((id) => picked.has(id)) : null };
}
