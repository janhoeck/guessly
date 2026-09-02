import { fileURLToPath } from "node:url";

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
  anthropicApiKey: string;
  anthropicModel: string;
  dataDir: string;
}

/**
 * Overridable so a deploy can move off it without a release, but not something
 * to tune casually — the prompt in content/prompt.ts is written for a model
 * that can search and follow a strict tool schema.
 */
const DEFAULT_MODEL = "claude-opus-5";

/**
 * Read once at start and throw on anything missing. The API key is required
 * *here* and not by the game server, because this is the only process that
 * talks to the model — a server with an empty bank serves misses, not
 * surprises.
 */
export function loadFillConfig(env: NodeJS.ProcessEnv = process.env): FillConfig {
  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required — the fill tool generates rounds with Claude. Copy tools/fill/.env.example to tools/fill/.env and set it.",
    );
  }

  const anthropicModel = (env.ANTHROPIC_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  // The default must land on the directory the game server serves from —
  // filling any other bank is pouring water beside the glass. The server's
  // own default is apps/game/data, resolved the same way against its module.
  const dataDir =
    (env.DATA_DIR ?? "").trim() ||
    fileURLToPath(new URL("../../../apps/game/data", import.meta.url));

  return { anthropicApiKey, anthropicModel, dataDir };
}
