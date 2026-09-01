export interface Config {
  port: number;
  /**
   * An explicit allowlist, never "*" — the socket is the only way into lobby
   * state, and that state is held in this process's memory.
   */
  allowedOrigins: string[];
  /** Rounds are built by Claude, so there is no game without this. */
  anthropicApiKey: string;
  anthropicModel: string;
}

/**
 * Overridable so a deploy can move off it without a release, but not something
 * to tune casually — the prompt in content/prompt.ts is written for a model
 * that can search and follow a strict tool schema.
 */
const DEFAULT_MODEL = "claude-opus-5";

/**
 * Read once at boot and throw on anything wrong. A misconfigured origin list is
 * a deploy mistake, and failing to start is a far louder way to report it than
 * serving traffic nobody expected to be able to reach.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${JSON.stringify(env.PORT)}`);
  }

  const allowedOrigins = (env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must list at least one origin");
  }
  if (allowedOrigins.includes("*")) {
    throw new Error('CORS_ORIGINS must name origins explicitly; "*" is never allowed');
  }

  // Checked at boot for the same reason as the origin list: a server that
  // cannot build a round is a server that will fail in front of players three
  // clicks later, and a crash at start-up says so far more loudly.
  const anthropicApiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
  if (!anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required — rounds are sourced from Claude. Copy apps/game/.env.example to apps/game/.env and set it.",
    );
  }

  const anthropicModel = (env.ANTHROPIC_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  return { port, allowedOrigins, anthropicApiKey, anthropicModel };
}
