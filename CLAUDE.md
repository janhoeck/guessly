# Guessly

Guessly is a realtime multiplayer party game you play together with your friends.
Everyone sees the same thing at the same time, and the goal is to work out what it
is faster than everybody else.

## Round Loop

Each round follows the same cycle:

1. A topic is picked at random.
2. An AI sources a matching piece of content for that topic (an image, or a snippet
   of song lyrics) *and the question to ask about it*.
3. The content is shown to all players simultaneously.
4. Players have **20 seconds** to type their guess.
5. The correct answer is revealed and the standings settle.
6. A short intermission, then the next countdown — until a player reaches the
   target score.

**Every round carries a question** — "Which country's flag is this?", "Who sings
this?" — sourced with the content rather than derived from the topic, because
the right question depends on the subject and not on the category it came from.
A round about a person asks who; the same topic's next round might ask what a
place is called.

## Starting a Game

Pressing start does not open a round. It opens a **countdown**, and the content
is fetched against it:

1. `lobby:start` moves the lobby to `countdown` and stamps `round.startsAt` at
   `now + COUNTDOWN_DURATION_MS`. The snapshot goes out immediately.
2. Every client — host and guests alike — sees `status` leave `lobby` and
   navigates to `/<CODE>`. The lobby modal on `/` is for a lobby; a game is a
   place you are at.
3. The countdown runs 3 · 2 · 1 · GO while the AI is asked for the round.
4. The round goes live when **both** are done. The countdown is a floor, not a
   target: content that arrives early waits for it, and content that arrives
   late starts the clock from when it lands, so nobody is handed a round that is
   already half over.
5. At `endsAt` the server reveals the answer and moves to `intermission`.
6. `INTERMISSION_DURATION_MS` later the server either opens the next countdown
   or, if somebody has reached the target, moves to `finished`.

Rounds two onward reach step 1 through `store.advance` rather than
`lobby:start`, and everything after that is identical — the same countdown, the
same request to the same source, the same floor. `game/rounds.ts` owns the chain
and stops only on a winner, an abandoned round, or a lobby that has gone.

If the content cannot be built at all, the lobby goes back to `lobby`, everybody
is returned to `/`, and `round:failed` says why. A game that quietly strands
five people on a countdown is worse than one that admits it failed.

The three seconds are spent on a countdown rather than a spinner because the
wait is real — a web search takes as long as it takes — and a number falling is
a better thing to watch than a wheel turning.

## Sourcing Content

`apps/game/src/content/` asks Claude for a round. Three things make the reply
safe to parse, and none of them is hope:

- **It is a `strict` tool call, not prose.** `submit_round` carries a JSON Schema
  with `additionalProperties: false`, so the input validates by construction.
  There is no fenced block to find and no preamble to strip.
- **It is read back through `parseSubmission`.** The schema promises shape; the
  parser enforces the *rules* a schema cannot express — an answer short enough
  to type, a question that does not name the answer, a lyrics snippet that does
  not give the song away, a URL that could be an image.
- **A rejected round is asked for again with the reason.** Re-rolling the same
  prompt tends to make the same mistake; naming the mistake does not.

Image rounds get the `web_search` server tool and return up to three candidate
URLs, best first. Each is probed — HEAD, then a ranged GET, checking for an
`image/*` content type — and the first that answers wins; the browser's own
`onError` is the last mile, because a host can serve the server and still refuse
a browser. Lyrics rounds get no search: a paraphrase is written from what the
model already knows, and the two tool lists are stable so each keeps its own
cached prompt prefix.

**Lyrics are never reproduced.** The prompt asks for a 3–5 line paraphrase — the
same imagery, person and running order, none of the actual words — and the UI
labels it "lyrics, paraphrased" rather than letting anyone assume otherwise.
Real lyrics are copyrighted and this game does not quote them.

`ANTHROPIC_API_KEY` is required at boot. A server that cannot build a round will
fail in front of players three clicks later, and a crash at start-up says so far
more loudly.

## Guessing

A player may guess as often as they like inside the 20 seconds; a correct one
closes their account for that round and every seat gets one. `round:guess`
quotes the round number back, so an answer typed as the clock ran out cannot be
scored against the next round.

**A miss is told to the guesser and to nobody else.** It is the only thing in
this game that does not ride in the snapshot, which is what lets the field clear
and shake without the room being shown who fumbled it. A *correct* answer is
public the instant it is scored — a `RoundResult` carrying the seat, the elapsed
time and the points — because watching somebody else's row settle at 1.4 seconds
while you are still typing is the pressure the round is made of, and it gives
nothing away.

**Matching is normalised, then forgiving.** `lobby/matching.ts` folds away case,
accents, punctuation, `&`, a leading article and stray whitespace, then compares
against the answer and every alias with a small edit budget scaled by the
target's length: nothing under five characters, one to ten, two beyond. The
tiers are set by where real collisions are rather than by round numbers —
"Austria"/"Australia" and "Slovakia"/"Slovenia" are two edits apart, so the
second edit is held back until eleven characters.

## Scoring

- Every player who answers correctly within the 20 seconds scores points.
- Points fall **linearly with time**, from `ROUND_MAX_POINTS` (20) on the
  instant to `ROUND_MIN_POINTS` (5) on the buzzer. A perfect game reaches the
  default target in five rounds and a slow one in twenty.
- A wrong answer, or no answer at all, is worth **0 points**.
- The server stamps when each guess *arrives* and clamps the elapsed time to the
  round, so a guess that beats the reveal timer by a millisecond is worth the
  minimum rather than a negative number.
- The round runs its full 20 seconds so that slower players still have a chance
  to score. It does *not* end when the *first* player answers — but it does end
  when the *last* one does: once every connected player has it, the rest of the
  clock is a locked field and a bar emptying in front of people who are done.

## Winning

The first player to reach the target score wins the game. The host chooses the
target when creating the lobby; the default is **100 points**.

The check happens when the *intermission* ends, not at the reveal, so the round
somebody won on still gets its beat: the answer goes up, the scores settle, and
only then is the game over. The lobby moves to `finished` and every client
navigates to `/<CODE>/results` — **which is deliberately a blank page for now.**
The winner screen and a rematch on the same lobby are the next piece of work.

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

**Configuration** is read once at boot by `apps/game/src/config.ts`. Copy
`apps/game/.env.example` to `apps/game/.env` and put your key in it; the server
loads that file itself, through Node's own `process.loadEnvFile`, resolved
against the module so the working directory does not matter. A real environment
variable beats the file, so a deploy sets its variables properly and ships no
`.env` at all.

Turbo runs tasks in **strict env mode**, which means a variable the shell
exports does not reach a task unless `turbo.json` names it. `PORT`,
`CORS_ORIGINS`, `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are listed under
`passThroughEnv` on `dev` and `start` — passed through rather than hashed,
because they are runtime configuration and one of them is a secret. A new
runtime variable has to be added there or it will silently go missing.

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

**A finished game is its own route.** `/<CODE>` resolves five possibilities now,
not four, and `finished` sends everybody to `/<CODE>/results`.

**The lobby is a modal; the game is a route.** A lobby is a room you are *in*,
so it opens over the landing page from `components/landing/entry-form.tsx` —
still the only client island there. A running game is somewhere you have gone,
so it is `/<CODE>`, and `components/game/game-room.tsx` is that page's only
island. Both render from the same `LobbyState` and emit on interaction; **no
control keeps its own copy of the selection it is editing.** The server sends a
full snapshot on every mutation, so the broadcast is what moves the UI, and a
second source of truth in the client would reintroduce exactly the drift the
snapshot design exists to prevent. The lobby dialog refuses Escape and outside
clicks: a stray keystroke must not cost somebody the lobby they just read out to
four friends.

**The connection lives outside the component tree**, in `lib/lobby-client.ts` —
a module singleton exposed to React through `useSyncExternalStore` in
`components/lobby/use-lobby.ts`. That is not premature cleverness; it is the
navigation. Pressing start moves every player from `/` to `/<CODE>`, and a
connection owned by either page's tree would be torn down and re-established in
the middle of the countdown. It is still not a second source of truth: the only
thing kept is the last snapshot the server sent, replaced whole.

**Each screen decides where it belongs, once.** `/<CODE>` resolves four
possibilities — the seat is still being reclaimed, there is no seat, the seat is
in a different lobby, the lobby is a lobby again — into a single route to go to.
Arriving with no seat sends you to `/?code=<CODE>` with the join field filled
in, because the usual way to reach that URL is a link somebody pasted into the
group chat.

**The server owns the clock, so the client measures its own drift.** Every
snapshot carries `serverNow` alongside its deadlines, and `serverNow()` in
`lib/lobby-client.ts` is `Date.now()` plus the offset from the last one. A
laptop four minutes fast still renders a correct countdown. Timers tick on
`requestAnimationFrame` (`components/game/use-server-clock.ts`), which is smooth
for the bar and stops on its own in a background tab.

**Design system:** dark only, tokens in `app/globals.css` — read the comments
there before touching a value, and run `pnpm test` after. The yellow `--primary`
is the single call to action on a screen; `--brand-cyan` and `--brand-pink` are
decorative only (rules, indicators, plates), never text and never a hover
surface.

## Lobbies

```ts
// `countdown` is a phase of its own rather than an early `in_round`: a
// countdown waits on a clock, a round waits on twelve people typing.
type LobbyStatus =
  | 'lobby' | 'countdown' | 'in_round' | 'intermission' | 'finished'

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
  usedAnswers: string[]  // this game's answers, so a source can avoid repeats
  createdAt: number
  lastActivityAt: number
}

// The server's round record. `answer` and `aliases` are held back from the wire
// until the reveal — the snapshot goes to everybody, so an answer in it one
// broadcast early is an answer on somebody's screen one broadcast early.
interface Round {
  number: number          // 1-based; every transition quotes it back
  topic: TopicId
  kind: RoundKind
  startsAt: number        // the countdown's zero
  endsAt: number | null   // startsAt + ROUND_DURATION_MS, once live
  content: RoundContent | null   // { question, imageUrl } or { question, snippet }
  answer: string | null
  aliases: string[]
  // Who got it, and when. Public from the moment it exists — see Guessing.
  results: { playerId: string; elapsedMs: number; points: number }[]
  revealed: boolean
  intermissionEndsAt: number | null  // stamped at the reveal
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
| `round:guess` | `{ roundNumber, guess }` | `{ correct: false }` or `{ correct: true, points, elapsedMs }` |
| `lobby:leave` | — | `{}` |

**Server → client**

| Event | Payload |
|---|---|
| `lobby:state` | full lobby snapshot, including `round` and `serverNow` |
| `lobby:closed` | `{ reason }` |
| `round:failed` | `{ message }` — the lobby is already back in `lobby` status |

The server sends a **full snapshot on every lobby mutation** — no incremental
`player_joined` / `host_changed` events. A 12-player lobby is a few hundred bytes,
so deltas would save nothing measurable while introducing the class of bugs where a
client silently drifts out of sync. The client renders from one object it always
trusts.

Round *lifecycle* — countdown, content, reveal, intermission — is a handful of
broadcasts a round, so it rides in the snapshot like everything else.
`round:guess` is the one exception: it is several a round per player, and its
ack is the only place a *wrong* guess is ever reported.

**The server owns the clock.** It stamps when each guess *arrives*, and clients
render their countdown from a server-sent deadline. Client timestamps are never
trusted — speed is the score here.

**Errors:** `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `GAME_IN_PROGRESS`, `NICKNAME_TAKEN`,
`INVALID_NICKNAME`, `INVALID_TARGET_SCORE`, `INVALID_TOPICS`, `NOT_HOST`,
`NOT_ENOUGH_PLAYERS`, `ROUND_NOT_OPEN`, `ALREADY_ANSWERED`, `INVALID_GUESS`,
`RATE_LIMITED`, `SERVER_ERROR`, and `RESUME_REJECTED` — on which the client
clears `sessionStorage` and returns to the join screen rather than retrying
forever.

Every payload is validated at the socket boundary; it is all untrusted input. A
per-socket cap of ~20 events/sec stops one spammer from wedging the event loop.

## Testing

`LobbyStore` is a pure module — no sockets, no `Date.now()`. The clock is injected,
and `create` / `join` / `resume` / `leave` / `start` / `disconnect` / `sweep` take
and return plain data.

That puts every rule above — host promotion, nickname collisions, both grace
periods, the reaping sweep, the round's own state machine, and the scoring of a
guess — under fast deterministic unit tests with a fake clock. `matching.ts` and
`scoring.ts` are pure functions of their arguments and are tested on their own,
which is where "would a player call this right?" is argued rather than in the
store. A thin adapter maps socket events to
store calls; integration tests with a real Socket.IO client cover join → drop →
resume and the error acks.

**No game logic in the socket handlers.**

The round's *timers* and the network call cannot be pure, so they are quarantined
in `game/rounds.ts`, which owns them and decides nothing — every decision it
makes it makes by asking the store, quoting the round number back so a slow
answer to an abandoned round is refused rather than guarded against.

`RoundContentSource` is the seam this hangs on: `store.start` issues a plain
`RoundRequest` and never learns how it is answered, so a live model, a fixture
and a stub are interchangeable. The socket tests drive a stub; `content/` is
tested through `parseSubmission`, which is where "the model said something
strange" has to come back as a rejection rather than a throw.

## Open Questions

These are deliberately not decided yet. Ask before assuming an answer:

- **Content repetition across games** — within a game, `usedAnswers` is handed to
  the source as an exclusion list. Across games there is nothing, because there
  is no database and nothing persists between sessions.
- **Prefetching** — content is fetched when the round opens, so the players pay
  the latency once per round behind the countdown. The loop now exists, and the
  intermission is five seconds of a server doing nothing: sourcing round *n+1*
  there would hide the wait entirely.
- **The results screen** — `/<CODE>/results` is a blank page. Final standings and
  a rematch on the same lobby (which needs scores reset and `start` opened up
  from `finished`) are unbuilt.
- **An empty room keeps playing** — if every player drops mid-game the chain
  goes on sourcing rounds until the empty-lobby sweep reaps the lobby five
  minutes later. Bounded and cheap, but it is a dozen wasted model calls.
