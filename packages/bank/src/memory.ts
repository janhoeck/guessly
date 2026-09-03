import type { RoundRepository } from "./repository.js";
import { createDrizzleRoundRepository, migrationsFolder, type BankDatabase } from "./postgres.js";

/**
 * The bank in memory, for tests: PGlite, which is Postgres itself compiled to
 * WASM rather than an imitation of it, running the same Drizzle queries and
 * the same migrations as the real repository — so every suite gets a fresh,
 * empty, *actual* Postgres without a server to install or clean up.
 *
 * One PGlite boots per process and every `init()` wipes it back to nothing —
 * dropping the schemas is milliseconds where booting WASM Postgres is a
 * second, and a fake clock's tests should not spend their budget on real
 * startup. The price is that two repositories open at once in one process
 * would share a database; a test creates one at a time, and vitest keeps
 * test files in separate processes.
 *
 * PGlite is a devDependency, imported lazily so the game server and the fill
 * tool never load a WASM build of Postgres they will never call. Nothing
 * outside a test has any business calling this.
 */

interface SharedPglite {
  exec(sql: string): Promise<unknown>;
  db: BankDatabase;
  migrate: () => Promise<void>;
}

let shared: Promise<SharedPglite> | null = null;

const openShared = (): Promise<SharedPglite> => {
  shared ??= (async () => {
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
    ]);
    const pglite = new PGlite();
    const db = drizzle(pglite);
    return {
      exec: (sql: string) => pglite.exec(sql),
      db,
      migrate: () => migrate(db, { migrationsFolder }),
    };
  })();
  return shared;
};

export function createInMemoryRoundRepository(): RoundRepository {
  return createDrizzleRoundRepository({
    async connect() {
      const client = await openShared();
      // Drizzle's migration journal lives in its own schema, so both go: a
      // kept journal over a dropped public schema would skip the rebuild.
      await client.exec(
        "DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
      );
      await client.migrate();
      return client.db;
    },
    async end() {
      // The instance is shared and the process is a test's; nothing to close.
    },
  });
}
