# Guessly

A realtime multiplayer party game. Everyone sees the same thing at the same time,
and the goal is to work out what it is faster than everybody else.

## Layout

A pnpm workspace driven by [Turborepo](https://turborepo.com):

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
packages/protocol/  # Shared TypeScript types for every socket event.
```

`packages/protocol` is compiled to `dist` and depended on by both apps, so turbo
builds it first and a changed message shape breaks the build on both sides
instead of drifting into a runtime mismatch.

## Getting started

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
cp apps/game/.env.example apps/game/.env
# then put a real key in apps/game/.env
pnpm dev
```

Rounds are built by Claude, so **`ANTHROPIC_API_KEY` is required** in
`apps/game/.env`. The game server refuses to start without one — a server that
cannot source a round would otherwise fail in front of players three clicks
later. `ANTHROPIC_MODEL` is optional and defaults to `claude-opus-5`.

`pnpm dev` runs the web app on <http://localhost:3000>, the game server on
<http://localhost:3001>, and `tsc --watch` on the protocol package behind both.

## Scripts

Run these from the repo root; turbo fans them out and skips packages whose
inputs have not changed.

| Command | What it does |
|---|---|
| `pnpm dev` | Web, game server and protocol watcher together |
| `pnpm build` | Builds protocol, then both apps |
| `pnpm start` | Runs the production builds |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm test` | Unit and integration tests |
| `pnpm clean` | Removes build output and turbo caches |

To run a single package: `pnpm --filter @guessly/game dev`, or scope a turbo task
with `pnpm turbo run build --filter @guessly/web`.

## Deployment

Two long-running Node processes on a host that can hold sockets and in-memory
state (Railway, Fly.io, Render, a VPS) — *not* Vercel serverless. There is no
database; nothing persists between sessions.
