# Guessly

Guessly is a realtime multiplayer party game you play together with your friends.
Everyone sees the same thing at the same time, and the goal is to work out what it
is faster than everybody else.

## Round Loop

Each round follows the same cycle:

1. A topic is picked at random.
2. An AI sources a matching piece of content for that topic (an image, or a snippet
   of song lyrics).
3. The content is shown to all players simultaneously.
4. Players have **20 seconds** to type their guess.
5. The correct answer is revealed and points are awarded.
6. Repeat until a player reaches the target score.

## Scoring

- Every player who answers correctly within the 20 seconds scores points.
- Points scale with **speed** — the faster the correct answer, the more points.
- A wrong answer, or no answer at all, is worth **0 points**.
- The round always runs its full 20 seconds. It does *not* end when the first
  player answers correctly, so slower players still have a chance to score.

## Winning

The first player to reach the target score wins the game. The host chooses the
target when creating the lobby; the default is **100 points**.

## Round Types

- **Image** — a picture is displayed and players guess what it shows.
- **Lyrics** — a snippet of song lyrics is displayed as text and players guess the
  song.

## Topics

The catalogue lives in `packages/protocol/src/topics.ts` and is the one source
both sides read: twelve topics, each carrying the `RoundKind` it produces.
Eleven are `image`; `music` is the only `lyrics` topic, so a host who switches it
off has quietly turned the game into pictures only — which is why the mapping is
data rather than prose, and why the lobby can say so out loud.

Every lobby stores its own selection. All twelve are on by default, at least one
is required, and the stored list is deduplicated and kept in catalogue order, so
two identical selections are literally equal however they were clicked.

The host picks in the lobby modal, and may re-pick while the lobby is being set
up — before the first round, or after a winner, ready for the next game — but
never mid-game. Within a game, the topic for each round is still drawn at random
from the selection.

IDs are wire format and never change. Labels and hints are copy and may.

## Architecture

Two processes, in a pnpm workspace driven by Turborepo:

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
packages/protocol/  # Shared TypeScript types for every socket event.
```

`packages/protocol` compiles to `dist`, and both apps depend on it, so turbo
builds it before either of them and keeps it in watch mode behind both servers
in dev. Everything runs from the root: `pnpm dev`, `pnpm build`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`. Each is a turbo task graph, so a package is only
rebuilt when its own inputs change.

The web tier is stateless and the game server is stateful, so they are kept apart
from the start: scaling the web tier can never fork lobby state, and going public
later means adding Socket.IO's Redis adapter to one process without touching the
protocol or the client.

`packages/protocol` is imported by both sides, so changing a message shape is a
compile error rather than a runtime mismatch between two processes that deploy
separately.

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4,
Socket.IO, pnpm, Turborepo.

**Deployment:** a long-running Node host (Railway, Fly.io, Render, VPS) — *not*
Vercel serverless, which cannot hold sockets or in-memory state.

**Dev:** `pnpm dev` at the root runs both — web on :3000, game server on :3001.
The client connects via `NEXT_PUBLIC_SOCKET_URL`. Socket.IO gets an explicit
origin allowlist, never `*`.

No database. Nothing persists between sessions.

## Web UI

`apps/web` renders on the server by default. A page is a composition: it holds
no state, imports nothing from `lib/socket`, and has no reason to ever become a
client component.

**Client islands sit at the interaction boundary, not above it.** `"use client"`
goes on the smallest component that genuinely needs state — never on the page or
the card around it. On the landing page that island is
`components/landing/entry-form.tsx`: when `lobby:create` and `lobby:join` are
wired up, the directive, the state and the socket calls land in that one file,
and the hero, card, round preview and step list around it keep rendering on the
server untouched. New screens follow the same shape — find the control that
needs to react, and stop the client boundary there.

**Components are reusable and semantic.** One component per job, split so a
future screen can take the piece it needs: `components/ui/` is shadcn-generated
(never hand-edited — override at the call site with `className`, so `shadcn add`
keeps working), `components/site/` is chrome shared across every screen, and
`components/<route>/` is route-specific. Markup uses the real element —
`<main>`, `<footer>`, `<form>`, `<label>`, `<ol>` — and anything purely
decorative is `aria-hidden` so it does not narrate a fake scoreboard to a screen
reader.

**Numbers in copy come from `@guessly/protocol`**, not from the sentence.
`ROUND_DURATION_MS`, `NICKNAME_MAX_LENGTH`, `MAX_PLAYERS_PER_LOBBY` and
`DEFAULT_TARGET_SCORE` are all rendered rather than typed, so the pitch cannot
drift away from what the server does.

**The lobby is a modal, not a route.** It is a room you are *in*, so it opens
over the landing page from `components/landing/entry-form.tsx` — still the only
client island there — with the connection itself one level down in
`components/lobby/use-lobby.ts`, the sole thing in the client that talks to the
game server. Everything under `components/lobby/` renders from the `LobbyState`
it is handed and emits on interaction; **no control keeps its own copy of the
selection it is editing.** The server sends a full snapshot on every mutation,
so the broadcast is what moves the UI, and a second source of truth in the
client would reintroduce exactly the drift the snapshot design exists to
prevent. The dialog refuses Escape and outside clicks: a stray keystroke must
not cost somebody the lobby they just read out to four friends.

**Design system:** dark only, tokens in `app/globals.css` — read the comments
there before touching a value, and run `pnpm test` after. The yellow `--primary`
is the single call to action on a screen; `--brand-cyan` and `--brand-pink` are
decorative only (rules, indicators, plates), never text and never a hover
surface.

## Lobbies

```ts
type LobbyStatus = 'lobby' | 'in_round' | 'intermission' | 'finished'

interface Player {
  id: string          // server-issued; this is the seat identity
  nickname: string
  score: number
  connected: boolean
  disconnectedAt: number | null
}

interface Lobby {
  code: string        // 5 chars
  status: LobbyStatus
  targetScore: number // host-set, default 100
  hostId: string
  topics: TopicId[]   // host-set, default all
  players: Map<string, Player>
  round: Round | null
  createdAt: number
  lastActivityAt: number
}
```

**Room codes** — 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. `I`, `L`,
`O`, `0` and `1` are excluded because codes get read aloud over voice chat and
those are the ones people mishear. Generated randomly, retried on collision;
input is uppercased.

**Rules**

- Max 12 players per lobby.
- Nicknames are 1–16 characters and unique within the lobby, case-insensitive.
- Joining is only allowed while status is `lobby`. Late joiners cannot win from far
  behind; rejoining after a drop is handled by token instead.
- The creator is host, and only the host can set the target score, pick the
  topics and start the game.
- If the host drops, the longest-present remaining player is promoted immediately,
  so one flaky connection cannot freeze everyone. A returning host does not take
  it back.
- A sweep every 60s deletes lobbies with nobody connected for 5 minutes, and any
  lobby idle for an hour.

**Reclaiming a seat**

On create and join the server issues a `playerId` and a `resumeToken` (32 random
bytes). The client keeps both in `sessionStorage`; on reconnect it emits
`lobby:resume` and the server rebinds the socket to the existing seat.

The token is required because player IDs appear in the state snapshot every player
receives — without a secret, anyone in the lobby could resume as someone else and
inherit their score. The token is only ever sent to its owner, never broadcast.

Grace periods differ by phase on purpose:

- **Before the game starts** — a disconnected player is dropped after 60s.
- **Once a game is running** — the seat is held until the game ends. Losing a
  player's score because their phone slept is worse than a greyed-out row.

## Realtime Protocol

Every client→server event takes an ack callback returning a Result, so nothing
throws across the wire:

```ts
type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string }
```

**Client → server**

| Event | Payload | Ack |
|---|---|---|
| `lobby:create` | `{ nickname, targetScore, topics }` | `{ code, playerId, resumeToken, state }` |
| `lobby:join` | `{ code, nickname }` | `{ playerId, resumeToken, state }` |
| `lobby:resume` | `{ code, playerId, resumeToken }` | `{ state }` |
| `lobby:setTarget` | `{ targetScore }` — host only | `{}` |
| `lobby:setTopics` | `{ topics }` — host only, while `lobby` or `finished` | `{}` |
| `lobby:start` | — host only | `{}` |
| `lobby:leave` | — | `{}` |

**Server → client**

| Event | Payload |
|---|---|
| `lobby:state` | full lobby snapshot |
| `lobby:closed` | `{ reason }` |

The server sends a **full snapshot on every lobby mutation** — no incremental
`player_joined` / `host_changed` events. A 12-player lobby is a few hundred bytes,
so deltas would save nothing measurable while introducing the class of bugs where a
client silently drifts out of sync. The client renders from one object it always
trusts.

Round events are higher-frequency and may need to be narrower; they are specified
with the game loop, along with `round:guess`.

**The server owns the clock.** It stamps when each guess *arrives*, and clients
render their countdown from a server-sent deadline. Client timestamps are never
trusted — speed is the score here.

**Errors:** `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `GAME_IN_PROGRESS`, `NICKNAME_TAKEN`,
`INVALID_NICKNAME`, `INVALID_TARGET_SCORE`, `INVALID_TOPICS`, `NOT_HOST`,
`NOT_ENOUGH_PLAYERS`, `RATE_LIMITED`, `SERVER_ERROR`, and `RESUME_REJECTED` — on
which the client clears `sessionStorage` and returns to the join screen rather
than retrying forever.

Every payload is validated at the socket boundary; it is all untrusted input. A
per-socket cap of ~20 events/sec stops one spammer from wedging the event loop.

## Testing

`LobbyStore` is a pure module — no sockets, no `Date.now()`. The clock is injected,
and `create` / `join` / `resume` / `leave` / `start` / `disconnect` / `sweep` take
and return plain data.

That puts every rule above — host promotion, nickname collisions, both grace
periods, the reaping sweep — under fast deterministic unit tests with a fake clock.
A thin adapter maps socket events to store calls; integration tests with a real
Socket.IO client cover join → drop → resume and the error acks.

**No game logic in the socket handlers.**

## Open Questions

These are deliberately not decided yet. Ask before assuming an answer:

- **Answer matching** — are free-text guesses fuzzy-matched? How tolerant is it of
  typos, alternative spellings and aliases (e.g. "USA" vs "United States")?
- **Content sourcing** — which AI/search provider finds the images and lyrics, and
  does it run per round or prefetch ahead of the players?
- **Content repetition** — how do we stop the same image or song appearing twice
  within a game, or across games?
- **Scoring curve** — the exact formula mapping answer time to points.
