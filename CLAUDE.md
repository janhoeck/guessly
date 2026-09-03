# Guessly

Guessly is a realtime multiplayer party game you play together with your friends.
Everyone sees the same thing at the same time, and the goal is to work out what it
is faster than everybody else.

## Round Loop

Each round follows the same cycle:

1. A topic is picked at random.
2. A matching piece of content (an image, or a snippet of song lyrics) is dealt
   from the round bank *along with the question to ask about it* — generated
   ahead of time by the fill tool, never on the spot.
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
3. The countdown runs 3 · 2 · 1 · GO while the round is drawn from the bank —
   ~0ms, or a failed build when the topic's shelf is empty in the lobby's
   language.
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
countdown, drawn away from the topic that failed, because the only build
failure left is a topic whose shelf is empty in the lobby's language, and the
next topic over is usually a stocked one. Only when the retry fails too does the lobby go back to
`lobby`, everybody return to `/`, and `round:failed` say why. A game that
quietly strands five people on a countdown is worse than one that admits it
failed — and a game ended on round eight because one topic had no pictures is
worse than a countdown that starts over.

The three seconds used to cover a real wait — a cold topic was a web search
made in front of the countdown. Every build is a bank draw now, so the
countdown is pacing rather than cover; it stays because a round that simply
appears is a round half the room missed the start of.

## Sourcing Content

Content is **produced and consumed by different processes**, and that split is
the architecture — visible in the workspace layout. `packages/bank` is the
seam both processes share: a persistent pool of verified rounds — Postgres
(through Drizzle) plus a bucket of content-addressed images — behind
`RoundRepository` and `ImageStore`. `apps/game/src/bank/source.ts` is the consuming side, answering
a build in ~0ms. `tools/fill` is the producing side: DeepSeek, asked for a
round, by a service the operator runs and watches. The server only ever talks
to the bank (`bank/source.ts` implements `RoundContentSource`) and **never
calls the AI** — it does not even depend on the SDK:

- **A build is served from the bank** when the topic holds a round *written in
  the lobby's language* whose answer the game has not used. The draw rotates —
  least-served first — so the pool deals its whole shelf before repeating a
  favourite across games, and a round rotates once however many languages it
  holds, because it is one round.
- **A miss fails the round.** There is no generator behind the server to fall
  back on — deliberately: an AI call is money and minutes, and it now only
  happens where somebody chose to spend both. The runner retries once on a
  fresh topic (see Starting a Game), and `pnpm fill` is the actual fix.
- **`pnpm fill` fills the shelves** — `tools/fill/src/main.ts` driving the
  filler in `tools/fill/src/fill.ts` in an endless loop: thinnest shelf first, gauged per language,
  generate, bank, and immediately start the next, until Ctrl+C. Every
  generation is a log line in front of the operator rather than a surprise in
  the server log, and the spend stops when the tool does. A topic whose
  generation fails is benched with a doubling backoff, so a topic run dry backs
  out of the rotation on its own and a dead API rests the whole loop instead of
  burning retries.
- **The bank is the only way a round reaches players**, so what used to be its
  serving fallbacks are now refusals at fill time: an image that cannot be
  downloaded or stored fails the fill — nothing is banked that players could
  not load — and a broken draw fails the round the same way an empty shelf
  does.

**A round is one subject and every language at once.** The generator is asked
for all of them in a single call and the bank stores what the round *shows* —
the picture, or the paraphrase — on one `rounds` row, with one `round_texts`
row per language for what it asks and accepts, so the picture and the cached prompt
prefix are paid for once and the second language costs a few hundred output
tokens. What that buys the players is a German lobby being dealt, in ~0ms, the
round an English lobby paid for last night. It also decides the gauge: the
fill tool measures a topic's shelf by the language it holds the *fewest*
rounds in, because a topic full of rounds none of which were written in German
is an empty shelf to a German lobby.

The schema lives in `packages/bank/src/schema.ts` — the one file both the
queries and `drizzle-kit generate` read, so the SQL migrations under
`packages/bank/drizzle/` can never drift from what the queries mean. `init()`
applies whatever is pending on every start; a schema change is an edit to
`schema.ts`, a `pnpm db:generate` in `packages/bank`, and both committed.
Rounds from before a language existed are simply rounds without that
language's text — dealt to English lobbies and passed over for German ones,
which is what an empty German shelf looks like until a fill run stocks it.

**Images are self-hosted, in a private bucket.** The generator downloads the
picture — whole file, capped, format verified by magic bytes rather than by
anybody's content-type header — and the bank stores it content-addressed
(SHA-256 name) in S3-compatible object storage, from where the game server
reads it and serves it at its own origin's `/img/<hash>.<ext>`. Players never
load from a third-party host, so hotlink blocks, CORS and link rot cannot kill
a round at render time. The source URL is kept in the bank for attribution.

**The bucket is a store, not an origin.** `packages/bank/src/s3.ts` is the
implementation both processes run (`createS3ImageStore`); `images.ts` keeps the
naming rule, the content types and `createDiskImageStore`, which is now only
the tests' store — a temp directory needs no credentials. The round in the
database holds a *name*, never a URL, so where the bytes live is one
implementation of `ImageStore` and nothing else in the codebase knows.

Serving through the server rather than pointing browsers at the bucket is the
deliberate half. It keeps the credentials in one process, the bucket
unreadable to the world, and — the part that matters — it keeps `/img/<hash>`
meaning exactly what it meant when the picture was a file, so moving the
pictures cost no migration of the rounds that point at them. What it costs is
a hop: the server reads the object on every browser cache miss. Content
addressing makes that once per picture per browser, forever, which is why
there is no cache in front of it.

The pictures moved because the alternative was a *volume*. A `DATA_DIR` on a
disk that survives restarts is a promise a deploy has to keep, and the deploy
that forgets it does not fail — it comes up with an empty image directory
beside a full database and 404s every round. The server now carries nothing on
disk at all. `pnpm migrate:images` is the one-way move that got the existing
pictures across: it verifies each file against the hash it is named by, skips
what is already in the bucket, deletes nothing, and exits non-zero if anything
was left behind.

`tools/fill/src/content/deepseek.ts` produces rounds, and three things make the
reply safe to parse, none of them hope:

- **It is a tool call, not prose.** `submit_round` carries a JSON Schema with
  `additionalProperties: false`, so there is no fenced block to find and no
  preamble to strip. The subject, the kind and the candidate URLs sit at the
  top level and `versions` carries one entry per language, its `language` enum
  built from the catalogue — so a new language is an entry in `languages.ts`
  and nothing in the schema.
- **It is read back through `parseSubmission`.** DeepSeek treats the schema as
  guidance rather than a guarantee, so the parser checks the shape along with
  the *rules* a schema could never express — an answer short enough
  to type, a question that does not name the answer, a lyrics snippet that does
  not give the song away, a URL that could be an image — and the rule the whole
  shape exists for: every language asked for came back. A round missing one is
  a round its lobbies could never be dealt, and it would sit on the shelf
  looking healthy, so it is refused while the reason can still be told to the
  model.
- **A rejected round is asked for again with the reason.** Re-rolling the same
  prompt tends to make the same mistake; naming the mistake does not. A round
  whose candidate URLs all fail to download is rejected the same way — and so
  is one the bank already holds under another spelling. The prompt's exclusion
  list names the topic's banked answers, and `dedup.ts` enforces its spirit
  before any image is downloaded: answers and aliases are folded (case,
  accents, `ß`, punctuation, a leading article) and the submission is checked
  against the banked answers *and* their aliases — though never alias against
  alias, because song rounds alias their artist and two Queen songs are not
  the same round. "United States" is refused while "USA" is on the shelf, with
  the collision named to the model. The bank's own `insert` still refuses
  exact repeats, as the guard against two fill processes racing.

**The model looks the picture up; it does not remember it.** DeepSeek cannot
browse, and for a while that was taken to mean the file names had to come out
of its memory — the prompt steered it toward canonical, rule-based names and
the download check caught the rest. That works exactly as far as the rules go.
`Flag of France.svg` is a rule. `Minecraft screenshot.png` is a wish, and the
file the article actually uses is `Screenshot from the Minecraft Nether.png`,
which nothing but a lookup was going to produce — so whole topics were
unfillable, three attempts and five invented URLs each, ten minutes and a
bench, every time they came up.

`tools/fill/src/content/wikimedia.ts` is the lookup, offered to the model on
image rounds as a second tool, `search_images`: MediaWiki's API, keyless, on
the same host the bytes come from, answering with file names that exist and
their sizes and captions. It asks two questions at once and interleaves the
answers — what is on the subject's **English Wikipedia article**, which is
guaranteed to be *about* the subject, and what **Commons** holds under that
name, which is ranked by relevance and is the only source for a subject with
no article. Alternating is what stops one of them spending the whole list;
filling from the article first showed twelve incidental photographs and never
the cosplay shot Commons had ranked first.

**The lookup finds; the model chooses.** That split is the design. A tool that
picked would have to know that a wordmark ruins a logo round, that a poster
spells a film's title out, that box art is not a screenshot — judgements the
prompt makes and an API cannot. What the tool does instead is make every
candidate URL real, which is the half the model was bad at. It still steers
toward subjects the open archives actually photograph: for pop culture the
person or thing behind the phenomenon rather than the meme; for a game, the
freely licensed gameplay screenshot when the search turns one up and the
arcade cabinet, console or cosplayed character when it does not.

Image rounds still return up to five candidate URLs, best first, and the first
that downloads as an actual image wins — the download check has not moved, it
just catches a bad *choice* now rather than a bad memory. A round whose
candidates all fail is retried with the lookup run again on this side and the
real file names quoted into the note, so the retry works even when the model
skipped the tool. Lyrics rounds involve no URLs and no lookup: a paraphrase is
written from what the model already knows.

**Lyrics are never reproduced.** The prompt asks for a 3–5 line paraphrase — the
same imagery, person and running order, none of the actual words — and the UI
labels it "lyrics, paraphrased" rather than letting anyone assume otherwise.
Real lyrics are copyrighted and this game does not quote them. Writing the
paraphrase in the song's own language makes that *harder*, because the real
words are the nearest phrasing to hand, so the prompt says so out loud.

`DEEPSEEK_API_KEY` belongs to the fill tool, which refuses to start without
it. The server neither needs nor checks it: a server with an empty bank fails
a round honestly, and the fix is a fill run, not a restart.

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
navigates to `/<CODE>/results`: the winner named over the standings — or the
game declared called off, because crowning whoever happened to be ahead of a
game nobody finished would be a lie — with ties sharing a rank, and a draw at
the top of a won game called a draw.

**`finished` is a setup phase, and the results screen is where the next game
is set up.** The server holds every host power open in `finished` exactly as
in `lobby` — topics, language, target score, and `start` itself — so the page
shows the same three controls the lobby modal does, wired to the same events.
**Play again** is a plain `lobby:start`: every score is reset to zero, the
game's `usedAnswers` are cleared (a rematch is a new game; across games it is
the bank's rotation that softens repeats), and round one's countdown opens.
Every results screen in the room notices the status leave `finished` and
navigates back to `/<CODE>`, the same way the first start moved everybody
there. The reset lives in `start` unconditionally rather than on a rematch
branch, so a game abandoned by a failed build cannot carry half a scoreboard
into the next attempt either. The seats, though, stay as they are: joining is
still only allowed while status is `lobby`, so a rematch is played by whoever
held a seat when the game ended.

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
up — before the first round, or on the results screen after a game has ended,
ready for the next one — but never mid-game. Within a game, the topic for each
round is still drawn at random from the selection.

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
first round or after a game has ended but never mid-game: a game's `usedAnswers` are in
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

Two long-running processes plus an on-demand service, in a pnpm workspace
driven by Turborepo:

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
                    # Reads the round bank; carries nothing on disk.
tools/fill/         # The fill service: the only process that calls the AI.
                    # Writes the round bank the game server reads.
packages/protocol/  # Shared TypeScript types for every socket event.
packages/bank/      # The round bank: repository, Drizzle schema, Postgres,
                    # S3 image store — the seam apps/game and tools/fill share
                    # instead of each other.
```

`packages/protocol` and `packages/bank` compile to `dist`; turbo builds them
before anything that depends on them and keeps them in watch mode behind the
servers in dev. Everything runs from the root: `pnpm dev`, `pnpm build`,
`pnpm lint`, `pnpm typecheck`, `pnpm test` — and `pnpm fill`, which runs the
fill service until Ctrl+C. Each is a turbo task graph, so a package is only
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
needs a Postgres (`DATABASE_URL`) and, for its images, an S3-compatible bucket
(`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) — no
volume, and nothing on the container's disk to lose. `PUBLIC_BASE_URL` must be
the origin players reach the game server on, because banked image URLs are
built from it.

**Dev:** `pnpm dev` at the root runs both — web on :3000, game server on :3001.
The client connects via `NEXT_PUBLIC_SOCKET_URL`. Socket.IO gets an explicit
origin allowlist, never `*`.

**Configuration** is read once at boot, by `apps/game/src/config.ts` for the
server and `tools/fill/src/config.ts` for the fill service — which is where
the API key lives now. Each process loads its own `.env` (copy the package's
`.env.example`), through Node's own `process.loadEnvFile`, resolved against
the module so the working directory does not matter; the fill service also
reads `apps/game/.env` as a fallback, so one key in one place is enough
locally. A real environment variable beats the files, so a deploy sets its
variables properly and ships no `.env` at all.

Turbo runs tasks in **strict env mode**, which means a variable the shell
exports does not reach a task unless `turbo.json` names it. `PORT`,
`CORS_ORIGINS`, `DATABASE_URL`, the four `S3_*` variables and
`PUBLIC_BASE_URL` are listed under `passThroughEnv` on `dev` and `start`, and
`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`,
`DATABASE_URL` and the same `S3_*` on `fill` — passed through
rather than hashed, because they are runtime configuration and some of them
are secrets. A new runtime variable has to be added there or it will silently
go missing. `DATA_DIR` survives on the `migrate:images` task alone, which is
the only thing left that wants to know where the pictures used to be.

**Lobbies are memory; content is an asset.** Lobby state lives in the game
server's process and dies with it — deliberately, see Lobbies. The round bank
persists: Postgres, through Drizzle, behind the `RoundRepository` interface
in `packages/bank` — written async so what is behind it stays swappable for
one new file rather than a change to any caller. Nothing outside
`packages/bank` knows what is plugged in. Two tables: `rounds` is what was photographed and
how often it has been dealt, `round_texts` is what each language asks and
accepts about it. The server and the fill service are two processes on the
one database, so `insert` checks and writes under a transaction-scoped
advisory lock on the topic — two polite writers instead of one surprised one.

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
not four, and `finished` sends everybody to `/<CODE>/results`, whose only
island is `components/results/results-room.tsx`. It makes the same
where-do-I-belong decision the game room makes, with one case swapped: a
*playing* status is its cue to go back to `/<CODE>`, because that is what the
host pressing Play again looks like from every other seat. The standings and
the next-game panel render from the snapshot like everything else — the panel
reuses the lobby modal's own controls, so a control gained in one place is
gained in both.

**Finding a lobby is a route; the lobby you find is still a modal.**
`/lobbies` is a composition like every other page — `components/lobbies/lobby-browser.tsx`
is its one island, subscribed to `lib/lobby-list.ts` the way the game screens are
subscribed to `lib/lobby-client.ts`. Joining from it opens the same dialog over
the same page, because `components/lobby/lobby-presence.tsx` owns both the
dialog and the move to `/<CODE>` when the game starts — the landing page and the
browse page render that one component rather than arguing the rule twice.

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

The browse list is the one screen with more than one yellow button, and it is
not an exception to the rule so much as the rule read literally: every joinable
row *is* the call to action, and picking which room to walk into is the only
thing the page is for. A row that cannot be joined drops back to `secondary`,
so the yellow still marks exactly what a click will do.

**Sound is garnish, and one voice.** Four sounds — countdown tick, GO, right,
wrong — all from one CC0 pack (Kenney's Interface Sounds, see
`public/sounds/README.md`), so they read as a set rather than four apps
talking at once. `lib/sounds.ts` owns playback: Web Audio for latency, the
context unlocked on the first gesture anywhere because the countdown itself is
not one, and `playSound` degrading to silence — never an error, never a queue
— when audio is unavailable. A verdict sound plays only where the verdict is
told: the wrong-sound rides the same one-person ack as the shake, so the room
hears who scored and never who fumbled.

**The tick counts a round out as well as in.** The last three seconds of the
twenty get one a second — the same glass ding, not a fifth file, because it is
the same event at either end of the round: a number changing next to zero. It
is keyed on the second the clock is *displaying* rather than on a timer of its
own, so the sound and the digit cannot drift apart and a tab returning from the
background hears the second it came back to instead of a queue of the ones it
missed. It is silent for a player who has already answered: the clock only runs
on past a correct guess because somebody else is still typing, and their last
three seconds are not this player's to be hurried by — the same reason the
round ends the moment the *last* connected player gets it.

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

**Every lobby is browsable.** `/lobbies` lists the rooms that exist right now —
the code, how many seats are taken, what language the rounds come in — and
joining one is the same `lobby:join` the code field on the landing page sends.
A room code used to be a thing you read out to four friends; the browse list
makes it a door anybody can knock on, and that is the trade this page is. What
it does not change is *who may take a seat*: a lobby that has started or filled
up refuses a newcomer exactly as it did before.

- **A lobby nobody is connected to is not listed.** Seats are held for a while
  after a tab closes, so the record outlives the room — but a lobby whose only
  occupant has gone is one the sweep is already on its way to delete, and
  walking somebody into it is worse than not mentioning it. The count is
  *seats* rather than connections, because seats are what the cap counts and
  therefore what decides whether one more fits.
- **A game in progress stays on the list**, and says so. It is greyed out with
  a pink indicator rather than hidden: a room mid-round is the most interesting
  kind of unavailable, and a list that quietly dropped it would read as a lobby
  that had closed. Same for a `finished` one, which shows as *Between games* —
  a rematch is for the seats already in it.
- **`joinable` rides in the summary rather than being re-derived.**
  `LobbySummary` is not a trimmed `LobbyState`: it goes to people who are not in
  the lobby, so it carries no player ids, no nicknames and no round. The one
  field that is a *judgement* — can somebody take a seat here — is the store's
  own answer, read off the same two predicates `join` uses, so a row the list
  offers is a row that will let you in.
- **It is a subscription, not a poll.** `lobby:browse` acks with the list and
  puts the socket in a room that is pushed `lobby:list` when it changes;
  `lobby:unbrowse` leaves. The push is guarded by a digest of what the room was
  last told, because a twelve-player lobby is mutated by every guess in it and
  almost none of that is visible from outside. With nobody browsing the list is
  never even built.

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
| `lobby:setTarget` | `{ targetScore }` — host only, while `lobby` or `finished` | `{}` |
| `lobby:setTopics` | `{ topics }` — host only, while `lobby` or `finished` | `{}` |
| `lobby:setLanguage` | `{ language }` — host only, while `lobby` or `finished` | `{}` |
| `lobby:start` | — host only, while `lobby` or `finished`; from `finished` it is the rematch and resets every score | `{}` |
| `round:guess` | `{ roundNumber, guess }` | `{ correct: false }` or `{ correct: true, points, elapsedMs }` |
| `lobby:browse` | — | `{ lobbies }` — every lobby somebody is in |
| `lobby:unbrowse` | — | `{}` |
| `lobby:leave` | — | `{}` |

**Server → client**

| Event | Payload |
|---|---|
| `lobby:state` | full lobby snapshot, including `round` and `serverNow` |
| `lobby:closed` | `{ reason }` |
| `lobby:list` | `{ lobbies }` — the browse list, in full, and only when it changed |
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

The browse list is tested from both of its ends. The store's own tests argue
what belongs on it — a full lobby, a running one, one nobody is connected to,
and the order they come back in — and the socket tests argue the subscription,
including the change that must *not* be pushed because no browser could see it.

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
fixture and a stub are interchangeable. The socket tests drive a stub; the
fill service's `content/` is tested through `parseSubmission`, which is where
"the model said something strange" has to come back as a rejection rather
than a throw, and through `wikimedia.ts`'s own parsing — a real API payload
read into candidates, which is where an article's sister-project logos, its
audio file and its 20px interface icons have to stop being offered as
pictures of the subject. Both are pure functions of a payload, so neither
test touches the network. The bank is tested from both of its ends, each in its own
package: `packages/bank`'s `postgres.test.ts` runs the real repository — the
same Drizzle queries and migrations as production — against PGlite, Postgres
compiled to WASM rather than an imitation of it, booted once per process and
wiped clean for every test; the game's `bank/source.test.ts` drives the
consuming side —
draws, cross-language aliases, and the misses that fail a round — against it;
and `tools/fill`'s `fill.test.ts` drives the producing side — thinnest shelf
first, exclusion lists, benching and backoff — with a stub generator and a
fake image store.

The image store is tested where it can be. A bucket cannot be booted in a test
the way Postgres can, so `packages/bank`'s `images.test.ts` argues the two
things that do not need one: the **naming rule**, which is the only place a
malformed `/img/` name is refused and therefore the only thing standing between
the route and a traversal — a real file under a name the store would never
issue has to be a miss *because of the name*, not because it happened to be
absent — and `readS3Config`, which is where a deploy that forgot a variable is
caught by the variable's own name. What is left untested is the SDK's
conversation with a server, which is why `init()` does a `HeadBucket` at boot:
the check a test cannot make, made once, where it is cheap.

## Open Questions

These are deliberately not decided yet. Ask before assuming an answer:

- **Content repetition across games** — within a game, `usedAnswers` is the
  exclusion list. Across games the bank rotates (least-served first), so a
  repeat now means the topic's whole shelf has been dealt — softened, not
  eliminated, and the honest fix is a deeper pool, which grows for as long as
  the fill tool is left running.
  Whether a *lobby* should also remember what it saw last game is undecided.
- **Nobody new can join a rematch.** Joining is still only allowed while
  status is `lobby`, so the results screen's Play again is for the seats
  already in the room — and a lobby whose players have left below
  `MIN_PLAYERS_TO_START` can never start again, which the page says out loud.
  Whether `finished` should open the door (it is a setup phase now, and the
  code on the results header is as readable-out as ever) is undecided.
- **Nothing backfills a language added later.** A new entry in the catalogue is
  all the schema, the tool and the UI need — but every round already banked was
  written without it, and `draw` passes those over, so the new language starts
  on an empty shelf and fills only as it is played. A backfill pass that asked
  the generator for the missing entry of a round it already has the picture for
  would be cheap and is unwritten; whether it is worth writing depends on how
  often a language is added, which is so far never.
- **Every lobby is listed, and none of them chose to be.** `/lobbies` shows
  whatever exists, so a group who only meant to play among themselves is
  discoverable by a stranger who reloads at the right moment. Nothing is opened
  that the code did not already open — joining is unchanged, and a started or
  full lobby still refuses — but an unlisted flag is an obvious thing to want
  and is unwritten. Whether it is worth having depends on whether strangers turn
  out to be the point of the page or the problem with it.
- **The bank has no curator** — nothing retires a round nobody solves, nothing
  turns near-miss guesses into aliases, and nothing decides how deep a topic's
  shelf *should* be: the fill tool fills evenly for as long as it runs. The
  play data to drive all three exists per round and is currently thrown away
  at reveal.
