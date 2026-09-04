# Guessly

A realtime multiplayer party game. Everyone sees the same thing at the same time,
and the goal is to work out what it is faster than everybody else.

## Layout

A pnpm workspace driven by [Turborepo](https://turborepo.com):

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
                    # Reads the round bank; carries nothing on disk.
apps/admin/         # Next.js app, behind a password. Browses and edits the
                    # round bank: pictures, paraphrases, questions, answers.
tools/fill/         # The fill service: the only process that calls the AI.
                    # Writes the round bank the game server reads.
packages/protocol/  # Shared TypeScript types for every socket event.
packages/bank/      # The round bank: repository, Postgres, image store — the
                    # seam apps/game, tools/fill and apps/admin share instead
                    # of each other.
packages/ui/        # The design system: theme, fonts, shadcn components and
                    # the wordmark, shared by apps/web and apps/admin.
```

`packages/protocol` and `packages/bank` are compiled to `dist` and depended on
across the workspace, so turbo builds them first and a changed shape breaks the
build on every side instead of drifting into a runtime mismatch. `packages/ui`
is not built: it ships source, and each Next app compiles it as its own.

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/game/.env.example apps/game/.env
cp apps/admin/.env.example apps/admin/.env
cp tools/fill/.env.example tools/fill/.env
# then put a real key in tools/fill/.env, a password in apps/admin/.env, and
# a Postgres and an image bucket in apps/game/.env — DATABASE_URL and the four
# S3_* variables. The fill tool and the admin both read that file as a
# fallback, and none of the three has a bank of its own: there is one bank.
pnpm dev
```

The game server never calls the AI — it deals rounds out of the bank. Filling
the bank is the fill service's job: `pnpm fill` generates rounds in an endless
loop (thinnest topic first, every language at once) until you stop it with
Ctrl+C, and it needs **`ANTHROPIC_API_KEY`** in `tools/fill/.env` (a key in
`apps/game/.env` still works as a fallback). `ANTHROPIC_MODEL` is optional and
defaults to `claude-opus-5`. A freshly cloned repo has an empty bank, so run
`pnpm fill` for a while before the first game.

`pnpm dev` runs the web app on <http://localhost:3000>, the game server on
<http://localhost:3001>, the admin on <http://localhost:3002>, and
`tsc --watch` on the shared packages behind all three.

The admin is where you look at what the fill tool made. Sign in with
`ADMIN_PASSWORD`, and every shelf is a table, every round a page: read the
picture or the paraphrase the way a lobby will, fix a question, an answer or
the aliases in either language, add the language a round is missing, swap a
picture for one you upload, or take the round off the shelf. It never
generates anything — that is still `pnpm fill`.

## Scripts

Run these from the repo root; turbo fans them out and skips packages whose
inputs have not changed.

| Command | What it does |
|---|---|
| `pnpm dev` | Web, game server, admin and shared-package watchers together |
| `pnpm fill` | Stocks the round bank with AI-generated rounds until Ctrl+C |
| `pnpm migrate:images` | One-way move of any on-disk pictures into the bucket |
| `pnpm build` | Builds the shared packages, then everything on top |
| `pnpm start` | Runs the production builds |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Unit and integration tests |
| `pnpm clean` | Removes build output and turbo caches |

To run a single package: `pnpm --filter @guessly/game dev`, or scope a turbo task
with `pnpm turbo run build --filter @guessly/web`.

## Deployment

Two long-running Node processes on a host that can hold sockets and in-memory
state (Railway, Fly.io, Render, a VPS) — *not* Vercel serverless. Lobby state
is memory and dies with the process; the round bank needs a Postgres
(`DATABASE_URL`) and, for its images, an S3-compatible bucket (`S3_ENDPOINT`,
`S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). Neither process
keeps anything on disk, so there is no volume to provision and none to forget.
The bucket stays private: the game server reads objects out of it and serves
them from its own origin at `/img/<hash>.<ext>`, so `PUBLIC_BASE_URL` must be
the origin players reach the game server on, because banked image URLs are
built from it. The fill service runs wherever it can reach that same database
and bucket — on the host, or locally — and only while you want the bank to
grow.

The admin is a third Node process on the same database and bucket, with one
more variable: `ADMIN_PASSWORD`, which is the only thing between the internet
and its delete button. It is optional — nothing else knows whether it is
running — and it reads pictures out of the bucket itself, so it needs no
`PUBLIC_BASE_URL` and no reachable game server.

If you are coming from a checkout that still has pictures under
`apps/game/data/images`, `pnpm migrate:images` moves them into the bucket. It
verifies every file against the hash it is named by, skips what is already
there, is safe to re-run, and deletes nothing — the directory is yours to
remove once it reports that everything arrived.
