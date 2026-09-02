import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LanguageId, RoundKind, TopicId } from "@guessly/protocol";
import {
  answerKey,
  type BankedRound,
  type BankedRoundText,
  type NewBankedRound,
  type RoundRepository,
} from "./repository.js";

/**
 * The bank on SQLite, via Node's own `node:sqlite` — no native dependency to
 * compile, nothing to install. Right for a single long-running process, which
 * is exactly what this server is; the day there are several of them sharing a
 * bank is the day this file gets a Postgres sibling behind the same interface.
 *
 * Two tables, because a round is one subject and many languages: `rounds` is
 * what the round *shows* and how often it has been dealt, `round_texts` is
 * what each language asks and accepts about it. A new language is then rows in
 * the second table — not a column, and not a second copy of every picture.
 *
 * A lyrics round's paraphrase is on `rounds` beside the picture, and that is
 * the same distinction rather than an exception: it is written in the song's
 * own language, so every room reads the same lines.
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
    subject        TEXT    NOT NULL,
    image_file     TEXT,
    source_url     TEXT,
    snippet         TEXT,
    snippet_language TEXT,
    created_at     INTEGER NOT NULL,
    times_served   INTEGER NOT NULL DEFAULT 0,
    last_served_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS rounds_topic ON rounds (topic);

  CREATE TABLE IF NOT EXISTS round_texts (
    round_id   INTEGER NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
    language   TEXT    NOT NULL,
    question   TEXT    NOT NULL,
    answer     TEXT    NOT NULL,
    answer_key TEXT    NOT NULL,
    aliases    TEXT    NOT NULL,
    PRIMARY KEY (round_id, language)
  );
  -- The draw asks which rounds of a topic exist in a language; the dedup asks
  -- whether a topic already answers to a word.
  CREATE INDEX IF NOT EXISTS round_texts_answer ON round_texts (language, answer_key);
`;

/**
 * The one migration this file has: a round used to carry its question, answer
 * and aliases inline, back when there was only one language to say them in.
 * Everything banked then is English.
 *
 * The bank is rebuilt rather than thrown away because its pictures were
 * downloaded once and paid for once. SQLite will not drop columns out from
 * under an index, so the old table is renamed, copied out in two directions
 * and dropped — all inside a transaction, because a bank half moved is worse
 * than a bank in either shape.
 */
const migrate = (db: DatabaseSync): void => {
  const columns = db
    .prepare("SELECT name FROM pragma_table_info('rounds')")
    .all() as { name: string }[];
  // No columns at all is a database that has never existed, and the schema
  // builds it. A `rounds` without `question` has already been through here.
  if (!columns.some((column) => column.name === "question")) return;

  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rounds' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];

  console.log("[bank] moving the rounds already banked into round_texts; they are English");
  db.exec("BEGIN IMMEDIATE");
  try {
    // A rename carries the indexes across under their old names, which the
    // schema below would then collide with.
    for (const index of indexes) db.exec(`DROP INDEX IF EXISTS "${index.name}"`);
    db.exec("ALTER TABLE rounds RENAME TO rounds_legacy");
    db.exec(SCHEMA);
    // The snippet stays on the round: it was never a per-language thing, it
    // just used to live next to fields that were.
    db.exec(
      `INSERT INTO rounds
         (id, topic, kind, subject, image_file, source_url, snippet,
          created_at, times_served, last_served_at)
       SELECT id, topic, kind, subject, image_file, source_url, snippet,
              created_at, times_served, last_served_at
         FROM rounds_legacy`,
    );
    db.exec(
      `INSERT INTO round_texts (round_id, language, question, answer, answer_key, aliases)
       SELECT id, 'en', question, answer, answer_key, aliases FROM rounds_legacy`,
    );
    db.exec("DROP TABLE rounds_legacy");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

/**
 * A row as SQLite hands it back, typed at the boundary and nowhere else.
 * Aliases rather than interfaces so they carry the implicit index signature the
 * cast from the driver's `Record<string, SQLOutputValue>` needs.
 */
type RoundRow = {
  id: number;
  topic: string;
  kind: string;
  subject: string;
  image_file: string | null;
  source_url: string | null;
  snippet: string | null;
  snippet_language: string | null;
};

type TextRow = {
  language: string;
  question: string;
  answer: string;
  aliases: string;
};

const toText = (row: TextRow): BankedRoundText => ({
  question: row.question,
  answer: row.answer,
  aliases: JSON.parse(row.aliases) as string[],
});

export function createSqliteRoundRepository(path: string): RoundRepository {
  let db: DatabaseSync | null = null;

  /** Init is the only place `db` is assigned; everything else may insist on it. */
  const open = (): DatabaseSync => {
    if (db === null) throw new Error("round repository used before init()");
    return db;
  };

  /** Every language one round was written in, gathered back into one object. */
  const textsFor = (roundId: number): BankedRound["texts"] => {
    const rows = open()
      .prepare(
        `SELECT language, question, answer, aliases
           FROM round_texts WHERE round_id = ? ORDER BY language`,
      )
      .all(roundId) as TextRow[];

    const texts: BankedRound["texts"] = {};
    for (const row of rows) texts[row.language as LanguageId] = toText(row);
    return texts;
  };

  return {
    async init() {
      if (path !== ":memory:") {
        await mkdir(dirname(path), { recursive: true });
      }
      db = new DatabaseSync(path);
      // WAL lets the server deal rounds while the fill tool — its own
      // process, on the same file — banks new ones. The busy timeout is for
      // the moments both write at once: wait politely instead of throwing
      // SQLITE_BUSY at whoever came second. Both are meaningless for
      // :memory:, and harmless.
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("PRAGMA foreign_keys = ON;");
      migrate(db);
      db.exec(SCHEMA);
    },

    async insert(round: NewBankedRound, now: number, served: boolean) {
      const languages = Object.keys(round.texts) as LanguageId[];
      if (languages.length === 0) return false;

      const database = open();
      // Checked, then written, in one immediate transaction: the write lock
      // is taken before the check, so nothing can interleave with it — not
      // this process, and not the other one, now that the fill tool and the
      // server share the file. The check is as good as the unique index it
      // replaces, and it is a check rather than an index because the answer
      // being looked for now lives one table away from the topic that scopes
      // it.
      const clashes = database.prepare(
        `SELECT 1 FROM round_texts
           JOIN rounds ON rounds.id = round_texts.round_id
          WHERE rounds.topic = ? AND round_texts.language = ? AND round_texts.answer_key = ?
          LIMIT 1`,
      );

      database.exec("BEGIN IMMEDIATE");
      try {
        for (const language of languages) {
          const text = round.texts[language];
          if (text === undefined) continue;
          if (clashes.get(round.topic, language, answerKey(text.answer)) !== undefined) {
            database.exec("ROLLBACK");
            return false;
          }
        }

        const inserted = database
          .prepare(
            `INSERT INTO rounds
               (topic, kind, subject, image_file, source_url, snippet, snippet_language,
                created_at, times_served, last_served_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            round.topic,
            round.kind,
            round.subject,
            round.imageFile,
            round.sourceUrl,
            round.snippet,
            round.snippetLanguage,
            now,
            served ? 1 : 0,
            served ? now : null,
          );
        const roundId = Number(inserted.lastInsertRowid);

        const addText = database.prepare(
          `INSERT INTO round_texts
             (round_id, language, question, answer, answer_key, aliases)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const language of languages) {
          const text = round.texts[language];
          if (text === undefined) continue;
          addText.run(
            roundId,
            language,
            text.question,
            text.answer,
            answerKey(text.answer),
            JSON.stringify(text.aliases),
          );
        }

        database.exec("COMMIT");
        return true;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    async draw(topic, language, excludeAnswers, now) {
      const excludeKeys = excludeAnswers.map(answerKey);
      const placeholders = excludeKeys.map(() => "?").join(", ");
      // Joined rather than filtered after the fact: a round with no text in
      // this language is a round this lobby cannot be shown, so drawing it and
      // then discarding it would deal the topic's rotation to nobody.
      const row = open()
        .prepare(
          `SELECT rounds.id, rounds.topic, rounds.kind, rounds.subject,
                  rounds.image_file, rounds.source_url,
                  rounds.snippet, rounds.snippet_language
             FROM rounds
             JOIN round_texts ON round_texts.round_id = rounds.id
            WHERE rounds.topic = ? AND round_texts.language = ?
              ${excludeKeys.length > 0 ? `AND round_texts.answer_key NOT IN (${placeholders})` : ""}
            ORDER BY rounds.times_served ASC, COALESCE(rounds.last_served_at, 0) ASC, RANDOM()
            LIMIT 1`,
        )
        .get(topic, language, ...excludeKeys) as RoundRow | undefined;
      if (row === undefined) return null;

      open()
        .prepare("UPDATE rounds SET times_served = times_served + 1, last_served_at = ? WHERE id = ?")
        .run(now, row.id);

      return {
        id: row.id,
        topic: row.topic as TopicId,
        kind: row.kind as RoundKind,
        subject: row.subject,
        imageFile: row.image_file,
        sourceUrl: row.source_url,
        snippet: row.snippet,
        snippetLanguage: row.snippet_language,
        texts: textsFor(row.id),
      };
    },

    async count(topic, language) {
      const row = open()
        .prepare(
          `SELECT COUNT(*) AS n
             FROM rounds
             JOIN round_texts ON round_texts.round_id = rounds.id
            WHERE rounds.topic = ? AND round_texts.language = ?`,
        )
        .get(topic, language) as { n: number };
      return row.n;
    },

    async answers(topic) {
      const rows = open()
        .prepare(
          `SELECT round_texts.answer AS answer
             FROM rounds
             JOIN round_texts ON round_texts.round_id = rounds.id
            WHERE rounds.topic = ?
            ORDER BY rounds.id, round_texts.language`,
        )
        .all(topic) as { answer: string }[];
      return rows.map((row) => row.answer);
    },

    async aliases(topic) {
      const rows = open()
        .prepare(
          `SELECT round_texts.aliases AS aliases
             FROM rounds
             JOIN round_texts ON round_texts.round_id = rounds.id
            WHERE rounds.topic = ?
            ORDER BY rounds.id, round_texts.language`,
        )
        .all(topic) as { aliases: string }[];
      return rows.flatMap((row) => JSON.parse(row.aliases) as string[]);
    },

    async close() {
      db?.close();
      db = null;
    },
  };
}
