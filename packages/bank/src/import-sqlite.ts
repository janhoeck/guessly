import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { migrationsFolder } from "./postgres.js";
import { rounds, roundTexts } from "./schema.js";

/**
 * One-time move of a SQLite bank into Postgres: `pnpm db:import [rounds.db]`.
 *
 * Reads the two-table SQLite shape — the one every bank has been in since the
 * language migration — and copies it whole, ids and serve counts included,
 * because the rotation's memory of what has been dealt is part of the bank.
 * The images stay where they are: they were always files on disk, and
 * `DATA_DIR` still points at them.
 *
 * It refuses a Postgres that already holds rounds rather than guessing at a
 * merge, and it refuses the pre-language SQLite shape outright — a bank that
 * old has to be opened by the old server once, which is the migration that
 * understood it.
 */

const loadEnvFallback = (): void => {
  // The same fallback the fill tool uses: the game server's .env is where
  // DATABASE_URL already lives on a dev machine. A real variable wins.
  for (const relative of ["../../../apps/game/.env", "../../../tools/fill/.env"]) {
    try {
      process.loadEnvFile(fileURLToPath(new URL(relative, import.meta.url)));
    } catch {
      // No file is the normal case; what matters is the environment after.
    }
  }
};

const main = async (): Promise<void> => {
  loadEnvFallback();

  const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required — the Postgres this bank moves into.");
  }

  const sqlitePath =
    process.argv[2] ??
    fileURLToPath(new URL("../../../apps/game/data/rounds.db", import.meta.url));

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const columns = sqlite
      .prepare("SELECT name FROM pragma_table_info('rounds')")
      .all() as { name: string }[];
    if (columns.length === 0) {
      throw new Error(`${sqlitePath} has no rounds table — nothing to import`);
    }
    if (columns.some((column) => column.name === "question")) {
      throw new Error(
        `${sqlitePath} is in the pre-language shape — run the old game server against it once to migrate it, then import`,
      );
    }

    const roundRows = sqlite
      .prepare(
        `SELECT id, topic, kind, subject, image_file, source_url, snippet,
                snippet_language, created_at, times_served, last_served_at
           FROM rounds ORDER BY id`,
      )
      .all() as {
      id: number;
      topic: string;
      kind: string;
      subject: string;
      image_file: string | null;
      source_url: string | null;
      snippet: string | null;
      snippet_language: string | null;
      created_at: number;
      times_served: number;
      last_served_at: number | null;
    }[];

    const textRows = sqlite
      .prepare(
        `SELECT round_id, language, question, answer, answer_key, aliases
           FROM round_texts ORDER BY round_id, language`,
      )
      .all() as {
      round_id: number;
      language: string;
      question: string;
      answer: string;
      answer_key: string;
      aliases: string;
    }[];

    console.log(`[import] ${sqlitePath}: ${roundRows.length} rounds, ${textRows.length} texts`);

    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const db = drizzle(pool);
      await migrate(db, { migrationsFolder });

      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ n: count() }).from(rounds);
        if ((existing?.n ?? 0) > 0) {
          throw new Error(
            `the Postgres bank already holds ${existing?.n} rounds — refusing to import into it`,
          );
        }

        for (const row of roundRows) {
          await tx.insert(rounds).values({
            id: row.id,
            topic: row.topic,
            kind: row.kind,
            subject: row.subject,
            imageFile: row.image_file,
            sourceUrl: row.source_url,
            snippet: row.snippet,
            snippetLanguage: row.snippet_language,
            createdAt: row.created_at,
            timesServed: row.times_served,
            lastServedAt: row.last_served_at,
          });
        }

        for (const row of textRows) {
          await tx.insert(roundTexts).values({
            roundId: row.round_id,
            language: row.language,
            question: row.question,
            answer: row.answer,
            answerKey: row.answer_key,
            aliases: JSON.parse(row.aliases) as string[],
          });
        }

        // The ids came across verbatim, so the identity sequence has to be
        // told where they got to before it hands out the next one.
        await tx.execute(
          sql`SELECT setval(pg_get_serial_sequence('rounds', 'id'), (SELECT COALESCE(MAX(id), 1) FROM rounds), true)`,
        );
      });

      console.log(
        `[import] done — ${roundRows.length} rounds and ${textRows.length} texts are in Postgres`,
      );
    } finally {
      await pool.end();
    }
  } finally {
    sqlite.close();
  }
};

main().catch((error: unknown) => {
  console.error("[import] failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
