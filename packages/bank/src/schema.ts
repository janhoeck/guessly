import { bigint, index, integer, jsonb, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/**
 * The bank's three tables, as Drizzle sees them — the one schema both the
 * repository and `drizzle-kit generate` read, so the SQL migrations under
 * `drizzle/` can never drift away from the queries.
 *
 * Two of them, because a round is one subject and many languages: `rounds` is
 * what the round *shows* and how often it has been dealt, `round_texts` is
 * what each language asks and accepts about it. A new language is then rows in
 * the second table — not a column, and not a second copy of every picture.
 *
 * A lyrics round's paraphrase is on `rounds` beside the picture, and that is
 * the same distinction rather than an exception: it is written in the song's
 * own language, so every room reads the same lines.
 *
 * The third, `round_votes`, is what the players thought: one row per thumb,
 * written by the game server and read by the admin. Rows rather than two
 * counters on `rounds`, because a vote has a *when* and a *which language* —
 * a round disliked only in German lobbies is a German question to fix, not a
 * picture to replace — and because a table that only ever grows by insert
 * needs no lock and can be aggregated any way the operator later wants.
 *
 * Timestamps are epoch milliseconds in a `bigint`, not `timestamptz`, because
 * every caller passes the injected clock's `now: number` — the same numbers
 * the fake clocks in the tests hand out.
 */
export const rounds = pgTable(
  "rounds",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    topic: text("topic").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    imageFile: text("image_file"),
    sourceUrl: text("source_url"),
    snippet: text("snippet"),
    snippetLanguage: text("snippet_language"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    timesServed: integer("times_served").notNull().default(0),
    lastServedAt: bigint("last_served_at", { mode: "number" }),
  },
  (table) => [index("rounds_topic").on(table.topic)],
);

export const roundTexts = pgTable(
  "round_texts",
  {
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    answerKey: text("answer_key").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roundId, table.language] }),
    // The draw asks which rounds of a topic exist in a language; the dedup
    // asks whether a topic already answers to a word.
    index("round_texts_answer").on(table.language, table.answerKey),
  ],
);

export const roundVotes = pgTable(
  "round_votes",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    /** The lobby's language: the round as the voter read it. */
    language: text("language").notNull(),
    /** "up" or "down"; see `RoundVote` in the protocol. */
    vote: text("vote").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  // Every read of votes is "for these rounds", so this is the whole access path.
  (table) => [index("round_votes_round").on(table.roundId)],
);
