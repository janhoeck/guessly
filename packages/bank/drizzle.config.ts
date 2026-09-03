import { defineConfig } from "drizzle-kit";

/**
 * `drizzle-kit generate` reads the schema and writes SQL migrations into
 * `drizzle/`, which `init()` applies on every start — see `postgres.ts`. A
 * schema change is therefore: edit `schema.ts`, run `pnpm db:generate`,
 * commit both.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
