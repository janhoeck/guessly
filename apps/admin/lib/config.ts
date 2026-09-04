import { resolve } from "node:path";
import type { S3ImageStoreConfig } from "@guessly/bank";

/**
 * What the admin needs: the bank's whereabouts, and the one password.
 *
 * Next has already read this app's own `.env` into `process.env` by the time
 * anything here runs. What it has not read is `apps/game/.env`, which is
 * where the database and the bucket already live on every dev machine —
 * so that file is loaded as a fallback, exactly as the fill tool loads it and
 * for the same reason: one `DATABASE_URL` in one place, because two copies of
 * a secret drifting apart is how a process ends up pointed at the wrong bank.
 * `loadEnvFile` never overwrites, so this app's own file and the real
 * environment both beat the game's.
 *
 * The path is resolved against the working directory rather than this
 * module, because a Next build moves modules; `next dev` and `next start`
 * both run in the package directory, which is what the path assumes.
 */
export function loadEnvFallback(): void {
  const path = resolve(process.cwd(), "../game/.env");
  try {
    process.loadEnvFile(path);
  } catch (error) {
    // No file is the normal case in production. Anything else is worth a
    // line, but what matters is whether the environment ends up with enough
    // in it, and loadAdminConfig decides that.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[admin] ignoring ${path}:`, error);
    }
  }
}

export interface AdminConfig {
  databaseUrl: string;
  s3: S3ImageStoreConfig;
}

/**
 * The password, or a thrown explanation. Read on its own because the login
 * page needs it before anything has opened the bank, and the proxy needs it
 * on every request without opening anything at all.
 */
export function adminPassword(env: NodeJS.ProcessEnv = process.env): string {
  const password = (env.ADMIN_PASSWORD ?? "").trim();
  if (!password) {
    throw new Error(
      "ADMIN_PASSWORD is required — nobody can sign in to the admin without it. Copy apps/admin/.env.example to apps/admin/.env and set it.",
    );
  }
  return password;
}

/**
 * Where the bank is. Thrown on anything missing, by the variable's name.
 *
 * The bucket is read through the bank's own `readS3Config` — the same four
 * variables through the same function as the game server and the fill tool,
 * because three processes disagreeing about which bucket the pictures are in
 * is the failure that makes impossible. It is passed in rather than imported
 * so this module stays free of the bank's values; `lib/bank.ts` is the one
 * place that loads them.
 */
export function loadAdminConfig(
  readS3Config: (env: NodeJS.ProcessEnv, who: string) => S3ImageStoreConfig,
  env: NodeJS.ProcessEnv = process.env,
): AdminConfig {
  const databaseUrl = (env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required — the Postgres the round bank lives in, the same one the game server reads. Set it in apps/admin/.env, or in apps/game/.env which the admin reads as a fallback.",
    );
  }

  return { databaseUrl, s3: readS3Config(env, "apps/admin") };
}
