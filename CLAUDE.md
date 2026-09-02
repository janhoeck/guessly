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
3. The countdown runs 3 · 2 · 1 · GO while the round is fetched — from the
   bank in ~0ms, or from the AI when the bank has nothing for the topic.
4. The round goes live when **both** are done. The countdown is a floor, not a
   target: content that arrives early waits for it, and content that arrives
   late starts the clock from when it lands, so nobody is handed a round that is
   already half over.
5. At `endsAt` the server reveals the answer and moves to `intermission`.
6. `INTERMISSION_DURATION_MS` later the server either opens the next countdown
   or, if somebody has reached the target, moves to `finished`.

Rounds two onward reach step 1 through `store.advance` rather than
`lobby:start`, and everything after that is identical — the same countdown, the
same source, the same floor. The one difference is *when* the source is asked:
the moment a round goes live, `store.prepareNext` draws the next round's topic
early (quoting the running round's still-secret answer into the exclusion list)
and the runner starts fetching it behind the round on screen, so by the time
the intermission ends the content is usually already in hand and the countdown
is the only wait. The topic is drawn once and `advance` reuses it — the
prefetched content has to be about the round that actually opens. A prefetch
that fails resolves to nothing rather than rejecting, and the round is then
built against its countdown exactly as round one is: the prefetch is a head
start, never a new way for a round to fail. A winner makes the last prefetch a
wasted call; that is bounded at one per game. `game/rounds.ts` owns the chain
and stops only on a winner, an abandoned round, or a lobby that has gone.

If a round cannot be built, it is reopened **once** on a fresh topic — a new
countdown, drawn away from the topic that failed, which after a few games
usually lands on a stocked bank shelf, because the commonest build failure is a
single topic run dry. Only when the retry fails too does the lobby go back to
`lobby`, everybody return to `/`, and `round:failed` say why. A game that
quietly strands five people on a countdown is worse than one that admits it
failed — and a game ended on round eight because one topic had no pictures is
worse than a countdown that starts over.

The three seconds are spent on a countdown rather than a spinner because the
wait can be real — a bank hit is instant, but a cold topic is a web search, and
a web search takes as long as it takes — and a number falling is a better thing
to watch than a wheel turning.

## Sourcing Content

Content is **produced and consumed at different times**, and that split is the
architecture. `apps/game/src/bank/` is the consuming side: a persistent pool of
verified rounds — SQLite plus a directory of downloaded images — that answers a
build in ~0ms. `apps/game/src/content/` is the producing side: Claude, asked
for a round. The game only ever talks to the bank (`bank/source.ts` implements
`RoundContentSource`); the bank talks to the generator when it must:

- **A build is served from the bank** when the topic holds a round *written in
  the lobby's language* whose answer the game has not used. The draw rotates —
  least-served first — so the pool deals its whole shelf before repeating a
  favourite across games, and a round rotates once however many languages it
  holds, because it is one round.
- **A miss generates in the foreground** (this is the only time players wait on
  the AI) and the fresh round is banked on the way out, so the same work is
  never paid for twice.
- **A draw that leaves a topic below the low-water mark kicks a background
  top-up**, one round per topic at a time. The pool fills *because* the game is
  played, and an idle server spends nothing. Over time the generator drifts out
  of the hot path entirely.
- **The bank is an optimisation, never a new way to fail.** A broken draw falls
  through to the generator, a round that cannot be banked is still served, an
  image that cannot be stored is served from its source host.

**A round is one subject and every language at once.** The generator is asked
for all of them in a single call and the bank stores what the round *shows* —
the picture, or the paraphrase — on one `rounds` row, with one `round_texts`
row per language for what it asks and accepts, so the search, the picture and the cached prompt
prefix are paid for once and the second language costs a few hundred output
tokens. What that buys the players is a German lobby being dealt, in ~0ms, the
round an English lobby paid for last night. It also decides the gauge: the
low-water count asks how many rounds a topic holds *in the language being
dealt*, because a topic full of rounds none of which were written in German is
an empty shelf to a German lobby.

`sqlite.ts` carries one migration, and it exists to protect a bank that already
has pictures in it. A round used to carry its question, answer and aliases
inline, back when there was one language to say them in; the old table is
renamed, copied into `rounds` and `round_texts` — everything in it English, and
its paraphrase staying on the round, where it always belonged — and dropped,
inside a transaction, because a bank half moved is worse than a bank in either
shape. Those rounds go on being dealt to English lobbies and are
passed over for German ones, which is what an empty German shelf looks like
until play fills it.

**Images are self-hosted.** The generator downloads the picture — whole file,
capped, format verified by magic bytes rather than by anybody's content-type
header — and the bank stores it content-addressed (SHA-256 filename) and serves
it from this server's own origin at `/img/<hash>.<ext>`. Players never load
from a third-party host, so hotlink blocks, CORS and link rot cannot kill a
round at render time. The source URL is kept in the bank for attribution.

`content/claude.ts` produces rounds, and three things make the reply safe to
parse, none of them hope:

- **It is a `strict` tool call, not prose.** `submit_round` carries a JSON Schema
  with `additionalProperties: false`, so the input validates by construction.
  There is no fenced block to find and no preamble to strip. The subject, the
  kind and the candidate URLs sit at the top level and `versions` carries one
  entry per language, its `language` enum built from the catalogue — so a new
  language is an entry in `languages.ts` and nothing in the schema.
- **It is read back through `parseSubmission`.** The schema promises shape; the
  parser enforces the *rules* a schema cannot express — an answer short enough
  to type, a question that does not name the answer, a lyrics snippet that does
  not give the song away, a URL that could be an image — and the rule the whole
  shape exists for: every language asked for came back. A round missing one is
  a round its lobbies could never be dealt, and it would sit on the shelf
  looking healthy, so it is refused while the reason can still be told to the
  model.
- **A rejected round is asked for again with the reason.** Re-rolling the same
  prompt tends to make the same mistake; naming the mistake does not. A round
  whose candidate URLs all fail to download is rejected the same way.

Image rounds get the `web_search` server tool and return up to five candidate
URLs, best first; the first that downloads as an actual image wins. The prompt
steers subjects toward what open archives actually photograph — for pop
culture, the person or thing behind the phenomenon, never the meme or the
screenshot, which no open host has and no round should hotlink anyway. Lyrics
rounds get no search: a paraphrase is written from what the model already
knows, and the two tool lists are stable so each keeps its own cached prompt
prefix.

**Lyrics are never reproduced.** The prompt asks for a 3–5 line paraphrase — the
same imagery, person and running order, none of the actual words — and the UI
labels it "lyrics, paraphrased" rather than letting anyone assume otherwise.
Real lyrics are copyrighted and this game does not quote them. Writing the
paraphrase in the song's own language makes that *harder*, because the real
words are the nearest phrasing to hand, so the prompt says so out loud.

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
accents, German's `ß`, punctuation, `&`, a leading article and stray whitespace,
then compares against the answer and every alias with a small edit budget scaled
by the target's length: nothing under five characters, one to ten, two beyond.
The alias list spans languages — see Languages — so a German lobby scores
"France" as readily as "Frankreich". The
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

**A game can also simply run out of players.** Reaching the target is the way a
game is *won*; it is not the only way one ends. A party game needs a party, so a
running game the room has emptied out below `MIN_PLAYERS_TO_START` is over — a
game that could not have been *started* should not be carried on either, and
dealing the last player rounds to answer alone is a worse ending than saying so.
The lobby lands in the same `finished` state a win produces, whatever phase it
was in: the round in flight is dropped, the standings stand where the game left
them, and everybody goes to `/<CODE>/results` rather than watching countdowns for
an opponent who is not coming back.

**How fast depends on whether they can come back**, because the server cannot
tell a closed tab from a tunnel:

- **A departure is immediate.** `lobby:leave` gives the seat up, and a seat that
  is gone cannot return, so there is nothing to wait for.
- **A drop gets `DESERTED_GAME_GRACE_MS` (30s).** The seat is still held — that
  promise is not withdrawn, and the score is still on the board — but the *game*
  is called off if nobody has come back when it expires. Long enough for a
  refresh or a tunnel, short enough that nobody is left playing on their own.
  Coming back inside it costs nothing.

**The deadline rides in the snapshot**, as `desertedEndsAt` — stamped against
`serverNow` like every other one, and null while the room has enough people.
That is what makes the grace something players can see rather than something
that happens to them: `lib/desertion-notice.ts` reads the transition off two
snapshots and `lobby-client.ts` puts it in a toast — *"Martin dropped out. The
game ends in 30 seconds unless they come back."*, then either "Back in the game."
or, on the otherwise blank results page, "Nobody came back, so the game was
called off." The seconds are counted off the deadline rather than the constant,
so a tab that reloads eight seconds in says twenty-two.

The store owns the rule and no clocks. `leave` ends a game the remaining *seats*
could not field; `endIfDeserted` ends one the remaining *connections* cannot; and
`restampDesertion` — called on every roster change and every phase change — is
the one place the deadline is decided. It is stamped when the room *becomes* too
small and held, not restamped, while it stays that way: a third player dropping
is not a reason to give the second one another thirty seconds, and a deadline
that moved would render as a countdown running backwards. The waiting is
`game/rounds.ts`'s, like every other timer — the adapter tells it `rosterChanged`
on every leave, drop and resume, and it keeps a timer against whatever the store
has stamped.

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

## Languages

A lobby plays in one language, catalogued in
`packages/protocol/src/languages.ts`: English and German, each carrying a
label, its endonym and a BCP 47 tag. This is the **content** language and not
the interface's — the question a round asks, the answer it reveals and a lyrics
round's paraphrase all come in it, while the game's own furniture stays
English, which the lobby says out loud rather than leaving a host to find out.
The tag is what lets `round-stage.tsx` mark that content `lang="de"`, so a
screen reader does not read German with an English voice.

Every lobby stores its own, defaulting to English. The host picks it in the
lobby modal beside the topics, and — like the topics — may re-pick before the
first round or after a winner but never mid-game: a game's `usedAnswers` are in
one language and the next round is already being fetched in it, so a switch
halfway through would orphan the prefetch and hand the exclusion list a
language it no longer speaks.

A German round is not an English round translated on the way out — its question
is the question a German would ask and its answer is what a German would type,
both written rather than rendered. But it is the *same round*: one subject, one
photograph, one row in `rounds` and one `round_texts` row per language, all
produced in a single call to the generator. That is what makes a second
language nearly free and a third one additive: a catalogue entry, an enum the
tool schema builds from it, and rows.

**What the round shows does not follow the room; only what it asks does.** Two
things are deliberately *not* translated:

- **Names.** A brand, a band, a song title, a person, a product — the answer is
  the same string in every language, spelled the way the thing spells itself.
  "Nike" is "Nike". What changes around a name is the question and the aliases.
  The one exception is a work that genuinely has a local title people use, in
  which case that is the local answer and the original is an alias.
- **A lyrics round's paraphrase**, which is written in the language the song is
  *sung* in. A German room naming an English song reads English, because half
  of what makes a lyric recognisable is the language it is in, and a translated
  paraphrase of "Bohemian Rhapsody" is a round nobody gets. So there is exactly
  one snippet: it lives on `rounds` beside the picture rather than in
  `round_texts`, and the tool schema puts it at the top level rather than
  inside `versions` — the shape is what makes a translated one unrepresentable.
  It carries its own BCP 47 tag, which is the one thing on screen the lobby's
  own language does not predict, so the UI can mark the lines with it instead
  of reading English with a German voice. Null when the source did not give a
  usable one, because marking it with a guess is worse than not marking it.

**Guessing is looser than reading.** A lobby is shown its own language and is
scored against every language the round holds — the others' answers and aliases
ride along in the list `matchesAnswer` compares against, so a German room that
types "France" has still named the thing on the screen. It is also why
`lobby/matching.ts` folds `ß` to `ss` rather than letting it cost an edit
against the keyboards that cannot type it.

## Architecture

Two processes, in a pnpm workspace driven by Turborepo:

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
                    # Also owns the round bank: data/ holds rounds.db + images/.
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
Vercel serverless, which cannot hold sockets or in-memory state. The round bank
(`DATA_DIR`) must sit on a disk that survives restarts, or every deploy starts
with a cold pool; `PUBLIC_BASE_URL` must be the origin players reach the game
server on, because banked image URLs are built from it.

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
`CORS_ORIGINS`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `DATA_DIR` and
`PUBLIC_BASE_URL` are listed under `passThroughEnv` on `dev` and `start` —
passed through rather than hashed, because they are runtime configuration and
one of them is a secret. A new runtime variable has to be added there or it
will silently go missing.

**Lobbies are memory; content is an asset.** Lobby state lives in this process
and dies with it — deliberately, see Lobbies. The round bank persists: SQLite
(via Node's own `node:sqlite`, no native dependency) behind the
`RoundRepository` interface in `bank/repository.ts`, whose methods are async
*because* the next implementation is Postgres — swapping it in is one new file,
not a change to any caller. Nothing outside `bank/` knows which one is plugged
in. Two tables: `rounds` is what was photographed and how often it has been
dealt, `round_texts` is what each language asks and accepts about it.

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

**A toast is a transition, not a clock.** `desertedEndsAt` arriving where there
was null is a game starting to count down to being called off, and it going away
again is a reprieve or an obituary depending on the status beside it.
`lib/desertion-notice.ts` decides which, purely, from the two snapshots either
side — so the four outcomes are argued in a test rather than inside a socket
callback — and `lobby-client.ts` owns the toast. Notices go there rather than
into a component because the transition can land mid-navigation, and the
connection is the only thing on this side that does not unmount.

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
  language: LanguageId   // host-set, default 'en'; fixed for a whole game
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
  content: RoundContent | null   // { question, imageUrl }, or { question, snippet, snippetLanguage }
  answer: string | null
  aliases: string[]
  // Who got it, and when. Public from the moment it exists — see Guessing.
  results: { playerId: string; elapsedMs: number; points: number }[]
  revealed: boolean
  intermissionEndsAt: number | null  // stamped at the reveal
  // Drawn early by `prepareNext` so the *next* round's content can be fetched
  // behind this one; `advance` reuses it rather than drawing again.
  nextTopic: TopicId | null
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
- Taking a running game below `MIN_PLAYERS_TO_START` ends it — at once if you
  left, after `DESERTED_GAME_GRACE_MS` if you only dropped. See Winning.
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
  player's score because their phone slept is worse than a greyed-out row. What
  a long drop can end is the *game*, not the seat: if it leaves too few players
  connected to play, the game is called off 30s later and everybody keeps their
  score — see Winning.

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
| `lobby:create` | `{ nickname, targetScore, topics, language }` | `{ code, playerId, resumeToken, state }` |
| `lobby:join` | `{ code, nickname }` | `{ playerId, resumeToken, state }` |
| `lobby:resume` | `{ code, playerId, resumeToken }` | `{ state }` |
| `lobby:setTarget` | `{ targetScore }` — host only | `{}` |
| `lobby:setTopics` | `{ topics }` — host only, while `lobby` or `finished` | `{}` |
| `lobby:setLanguage` | `{ language }` — host only, while `lobby` or `finished` | `{}` |
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
`INVALID_NICKNAME`, `INVALID_TARGET_SCORE`, `INVALID_TOPICS`, `INVALID_LANGUAGE`,
`NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `ROUND_NOT_OPEN`, `ALREADY_ANSWERED`, `INVALID_GUESS`,
`RATE_LIMITED`, `SERVER_ERROR`, and `RESUME_REJECTED` — on which the client
clears `sessionStorage` and returns to the join screen rather than retrying
forever.

Every payload is validated at the socket boundary; it is all untrusted input. A
per-socket cap of ~20 events/sec stops one spammer from wedging the event loop.

## Testing

`LobbyStore` is a pure module — no sockets, no `Date.now()`. The clock is injected,
and `create` / `join` / `resume` / `leave` / `start` / `disconnect` /
`endIfDeserted` / `sweep` take and return plain data.

That puts every rule above — host promotion, nickname collisions, the grace
periods, the reaping sweep, the round's own state machine, when a game has run
out of players, and the scoring of a guess — under fast deterministic unit tests
with a fake clock. `matching.ts` and `scoring.ts` are pure functions of their
arguments and are tested on their own, which is where "would a player call this
right?" is argued rather than in the store. A thin adapter maps socket events to
store calls; integration tests with a real Socket.IO client cover join → drop →
resume, a game called off by a drop, and the error acks.

`game/rounds.ts` has its own tests for the clocks the socket tests cannot wait
out. They drive the runner against a real store and a source that never answers,
with the desertion grace injected small — which is the only thing that knob
exists for.

**No game logic in the socket handlers.**

The round's *timers* and the network call cannot be pure, so they are quarantined
in `game/rounds.ts`, which owns them and decides nothing — every decision it
makes it makes by asking the store, quoting the round number back so a slow
answer to an abandoned round is refused rather than guarded against.

`RoundContentSource` is the seam this hangs on: `store.start` issues a plain
`RoundRequest` and never learns how it is answered, so the round bank, a
fixture and a stub are interchangeable. The socket tests drive a stub;
`content/` is tested through `parseSubmission`, which is where "the model said
something strange" has to come back as a rejection rather than a throw. The
bank has its own two seams and tests both: `bank/sqlite.test.ts` runs the real
repository against `:memory:`, and `bank/source.test.ts` drives the pool logic
— draw, miss, top-up, and every never-fail fallback — with a stub generator
and a fake image store.

## Open Questions

These are deliberately not decided yet. Ask before assuming an answer:

- **Content repetition across games** — within a game, `usedAnswers` is the
  exclusion list. Across games the bank rotates (least-served first), so a
  repeat now means the topic's whole shelf has been dealt — softened, not
  eliminated, and the honest fix is a deeper pool, which grows with play.
  Whether a *lobby* should also remember what it saw last game is undecided.
- **The results screen** — `/<CODE>/results` is a blank page, with a toast the
  only thing that says why a called-off game ended. Final standings and a
  rematch on the same lobby (which needs scores reset and `start` opened up
  from `finished`) are unbuilt.
- **Nothing backfills a language added later.** A new entry in the catalogue is
  all the schema, the tool and the UI need — but every round already banked was
  written without it, and `draw` passes those over, so the new language starts
  on an empty shelf and fills only as it is played. A backfill pass that asked
  the generator for the missing entry of a round it already has the picture for
  would be cheap and is unwritten; whether it is worth writing depends on how
  often a language is added, which is so far never.
- **The bank has no curator** — nothing retires a round nobody solves, nothing
  turns near-miss guesses into aliases, and nothing but the low-water mark
  decides how deep a topic's pool should be. The play data to drive all three
  exists per round and is currently thrown away at reveal.
