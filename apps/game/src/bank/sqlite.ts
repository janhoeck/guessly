import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RoundKind, TopicId } from "@guessly/protocol";
import {
  answerKey,
  type BankedRound,
  type NewBankedRound,
  type RoundRepository,
} from "./repository.js";

/**
 * The bank on SQLite, via Node's own `node:sqlite` — no native dependency to
 * compile, nothing to install. Right for a single long-running process, which
 * is exactly what this server is; the day there are several of them sharing a
 * bank is the day this file gets a Postgres sibling behind the same interface.
 *
 * The API here is synchronous under the async signatures. That is fine: every
 * statement below is an indexed point read or a single-row write, microseconds
 * against a local file, not something to move off the event loop.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rounds (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    topic          TEXT    NOT NULL,
    kind           TEXT    NOT NULL,
    question       TEXT    NOT NULL,
    answer         TEXT    NOT NULL,
    answer_key     TEXT    NOT NULL,
    aliases        TEXT    NOT NULL,
    subject        TEXT    NOT NULL,
    snippet        TEXT,
    image_file     TEXT,
    source_url     TEXT,
    created_at     INTEGER NOT NULL,
    times_served   INTEGER NOT NULL DEFAULT 0,
    last_served_at INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS rounds_topic_answer ON rounds (topic, answer_key);
  CREATE INDEX IF NOT EXISTS rounds_topic ON rounds (topic);
`;

/** A row as SQLite hands it back, typed at the boundary and nowhere else. */
interface RoundRow {
  id: number;
  topic: string;
  kind: string;
  question: string;
  answer: string;
  aliases: string;
  subject: string;
  snippet: string | null;
  image_file: string | null;
  source_url: string | null;
}

const toBankedRound = (row: RoundRow): BankedRound => ({
  id: row.id,
  topic: row.topic as TopicId,
  kind: row.kind as RoundKind,
  question: row.question,
  answer: row.answer,
  aliases: JSON.parse(row.aliases) as string[],
  subject: row.subject,
  snippet: row.snippet,
  imageFile: row.image_file,
  sourceUrl: row.source_url,
});

export function createSqliteRoundRepository(path: string): RoundRepository {
  let db: DatabaseSync | null = null;

  /** Init is the only place `db` is assigned; everything else may insist on it. */
  const open = (): DatabaseSync => {
    if (db === null) throw new Error("round repository used before init()");
    return db;
  };

  return {
    async init() {
      if (path !== ":memory:") {
        await mkdir(dirname(path), { recursive: true });
      }
      db = new DatabaseSync(path);
      // WAL lets the sweep read while a top-up writes. Meaningless for
      // :memory:, harmless too.
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec(SCHEMA);
    },

    async insert(round: NewBankedRound, now: number, served: boolean) {
      const result = open()
        .prepare(
          `INSERT INTO rounds
             (topic, kind, question, answer, answer_key, aliases, subject,
              snippet, image_file, source_url, created_at, times_served, last_served_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (topic, answer_key) DO NOTHING`,
        )
        .run(
          round.topic,
          round.kind,
          round.question,
          round.answer,
          answerKey(round.answer),
          JSON.stringify(round.aliases),
          round.subject,
          round.snippet,
          round.imageFile,
          round.sourceUrl,
          now,
          served ? 1 : 0,
          served ? now : null,
        );
      return result.changes > 0;
    },

    async draw(topic, excludeAnswers, now) {
      const excludeKeys = excludeAnswers.map(answerKey);
      const placeholders = excludeKeys.map(() => "?").join(", ");
      const row = open()
        .prepare(
          `SELECT id, topic, kind, question, answer, aliases, subject,
                  snippet, image_file, source_url
             FROM rounds
            WHERE topic = ?
              ${excludeKeys.length > 0 ? `AND answer_key NOT IN (${placeholders})` : ""}
            ORDER BY times_served ASC, COALESCE(last_served_at, 0) ASC, RANDOM()
            LIMIT 1`,
        )
        .get(topic, ...excludeKeys) as RoundRow | undefined;
      if (row === undefined) return null;

      open()
        .prepare("UPDATE rounds SET times_served = times_served + 1, last_served_at = ? WHERE id = ?")
        .run(now, row.id);
      return toBankedRound(row);
    },

    async count(topic) {
      const row = open()
        .prepare("SELECT COUNT(*) AS n FROM rounds WHERE topic = ?")
        .get(topic) as { n: number };
      return row.n;
    },

    async answers(topic) {
      const rows = open()
        .prepare("SELECT answer FROM rounds WHERE topic = ? ORDER BY id")
        .all(topic) as { answer: string }[];
      return rows.map((row) => row.answer);
    },

    async close() {
      db?.close();
      db = null;
    },
  };
}
