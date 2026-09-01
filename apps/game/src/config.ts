export interface Config {
  port: number;
  /**
   * An explicit allowlist, never "*" — the socket is the only way into lobby
   * state, and that state is held in this process's memory.
   */
  allowedOrigins: string[];
}

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

  return { port, allowedOrigins };
}
