import { fileURLToPath } from "node:url";

/**
 * Read `apps/game/.env` into `process.env`, if there is one.
 *
 * Nothing else does this. `tsx` and `node` both leave `.env` alone unless they
 * are told otherwise, so without this call the file would be a file nothing
 * ever opens.
 *
 * The path is resolved against this module rather than the working directory,
 * so the server finds it whether it was started by turbo from the package, by
 * `node apps/game/dist/index.js` from the repo root, or by an editor's run
 * button. `src/` and `dist/` are both one level under the package, so the same
 * relative path works before and after a build.
 *
 * **A real environment variable wins over the file.** That is Node's own rule
 * for `loadEnvFile` and it is the right one here: the file is a local
 * convenience, and a deploy that sets its variables properly must not have
 * them quietly replaced by whatever a checked-out `.env` happens to say.
 */
export function loadEnvFile(): void {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  try {
    process.loadEnvFile(path);
  } catch (error) {
    // No file at all is the normal case in production, where the variables are
    // set for real. Anything else — unreadable, malformed — is worth saying out
    // loud, but it is not fatal on its own: what matters is whether the
    // environment ends up with enough in it, and loadConfig decides that.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[game] ignoring ${path}:`, error);
    }
  }
}

export interface Config {
  port: number;
  /**
   * The Postgres the round bank lives in — the same database the fill tool
   * writes. Required: a server without a bank cannot deal a single round,
   * and failing to start says so louder than failing every game.
   */
  databaseUrl: string;
  /**
   * An explicit allowlist, never "*" — the socket is the only way into lobby
   * state, and that state is held in this process's memory.
   */
  allowedOrigins: string[];
  /**
   * Where the bank's image files live. The rounds themselves are in Postgres
   * now, but what they show is still content-addressed files on disk, so a
   * deploy must put this on a disk that outlives the container.
   */
  dataDir: string;
  /**
   * The origin a *player's browser* reaches this server on. Banked images are
   * served from here (`/img/...`), and the URL goes out in the snapshot, so
   * localhost is only right on localhost.
   */
  publicBaseUrl: string;
}

/**
 * Read once at boot and throw on anything wrong. A misconfigured origin list
 * is a deploy mistake, and failing to start is a far louder way to report it
 * than serving traffic nobody expected to be able to reach.
 *
 * Deliberately nothing about the AI in here: the server only ever reads the
 * round bank, and the credentials live with the fill tool that writes it —
 * see `tools/fill`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${JSON.stringify(env.PORT)}`);
  }

  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required — the Postgres the round bank lives in. Copy apps/game/.env.example to apps/game/.env and set it.",
    );
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

  // Resolved against this module for the same reason as the .env file above:
  // the default has to land on apps/game/data whatever directory the server
  // was started from. The fill tool defaults to the same directory — filling
  // any other bank would be pouring water beside the glass.
  const dataDir =
    (env.DATA_DIR ?? "").trim() || fileURLToPath(new URL("../data", import.meta.url));

  const publicBaseUrl = ((env.PUBLIC_BASE_URL ?? "").trim() || `http://localhost:${port}`)
    .replace(/\/+$/, "");
  if (!/^https?:\/\//.test(publicBaseUrl)) {
    throw new Error(
      `PUBLIC_BASE_URL must be an origin like https://game.example.com, got ${JSON.stringify(env.PUBLIC_BASE_URL)}`,
    );
  }

  return { port, databaseUrl, allowedOrigins, dataDir, publicBaseUrl };
}
