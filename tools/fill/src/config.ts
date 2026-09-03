import { fileURLToPath } from "node:url";
import { REASONING_EFFORTS, type ReasoningEffort } from "./content/deepseek.js";

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
  /** Where the bank's image files go: the directory the game server serves. */
  dataDir: string;
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

  // The default must land on the directory the game server serves from —
  // filling any other bank is pouring water beside the glass. The server's
  // own default is apps/game/data, resolved the same way against its module.
  const dataDir =
    (env.DATA_DIR ?? "").trim() ||
    fileURLToPath(new URL("../../../apps/game/data", import.meta.url));

  return { deepseekApiKey, deepseekModel, deepseekReasoningEffort, databaseUrl, dataDir };
}
