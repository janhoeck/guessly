# Guessly

A realtime multiplayer party game. Everyone sees the same thing at the same time,
and the goal is to work out what it is faster than everybody else.

## Layout

A pnpm workspace driven by [Turborepo](https://turborepo.com):

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
                    # Reads the round bank; its data/ holds the bank's images/.
tools/fill/         # The fill service: the only process that calls the AI.
                    # Writes the round bank the game server reads.
packages/protocol/  # Shared TypeScript types for every socket event.
packages/bank/      # The round bank: repository, Postgres, image store — the
                    # seam apps/game and tools/fill share instead of each other.
```

`packages/protocol` and `packages/bank` are compiled to `dist` and depended on
across the workspace, so turbo builds them first and a changed shape breaks the
build on every side instead of drifting into a runtime mismatch.

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/game/.env.example apps/game/.env
cp tools/fill/.env.example tools/fill/.env
# then put a real key in tools/fill/.env
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
<http://localhost:3001>, and `tsc --watch` on the shared packages behind both.

## Scripts

Run these from the repo root; turbo fans them out and skips packages whose
inputs have not changed.

| Command | What it does |
|---|---|
| `pnpm dev` | Web, game server and shared-package watchers together |
| `pnpm fill` | Stocks the round bank with AI-generated rounds until Ctrl+C |
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
(`DATABASE_URL`) and, for its images, a disk that survives restarts
(`DATA_DIR`, default `apps/game/data`) — or every deploy starts with an empty
bank. `PUBLIC_BASE_URL` must be the origin players reach the game server on,
because banked image URLs are built from it. The fill service runs wherever it
can reach that same database and directory — on the host, or locally through a
tunnel — and only while you want the bank to grow.
