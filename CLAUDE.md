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
  burning retries. `pnpm fill -- --topic <id>` confines a run to the shelves
  named — repeat the flag, or comma-separate the ids — with the same loop,
  gauge and benching over a shorter list, so the topic a lobby just failed on
  can be topped up without paying for the other thirteen first. `parseFillArgs`
  in `config.ts` reads it, and refuses an id it does not know rather than
  quietly filling everything.
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
anybody's content-type header; the check and the cap are the bank's own
(`sniffImage`, `MAX_IMAGE_BYTES`), so the admin's upload passes the same
one; asked for as a browser would, with the page the picture was found on
as the referer, because the web's CDNs check for that where the archives ask
for a named agent instead (`headersFor` in `download.ts`) — and the bank
stores it content-addressed
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
disk at all.

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

`tools/fill/src/content/search.ts` is the lookup, offered to the model on
image rounds as a second tool, `search_images`: one call that asks every
configured **provider** at once and merges what they found into a list
tagged by source, with sizes and captions and the URL last on every line so
it is the thing to copy. The model may add `looking_for` — "gameplay
screenshot", "logo symbol only", "film still" — which the web search takes
as part of the query; the archives are asked by the subject's name alone,
because Commons' full-text search of "Portal 2 gameplay screenshot" matched
nothing where "Portal 2" matched plenty. The providers are worth different things, which
is why there are several and why they are merged rather than tried in turn:

- **The web** (`serper.ts`: Google Images, as serper.dev returns it) is the
  source for what the archives do not hold: a frame from a film, a gameplay
  screenshot of a console game, the swoosh on its own. This game is
  non-commercial and serves every picture from its own host, so where a file
  came from stops mattering once it is downloaded — *any site is fine*, and
  the prompt says so. Serper is a third party running the Google query, not
  Google — chosen because Google withdrew "search the entire web" from new
  Programmable Search Engines in January 2026 (fifty named domains is the
  most a new one searches, and the old whole-web engines end at the start
  of 2027) and Brave's image API wants a card on file. It needs
  `SERPER_API_KEY` (a few thousand free queries on signup, fractions of a
  cent each after), is optional — an account refusal benches it for an hour
  and the other sources carry on, and without the key the tool is the tool
  as it was — and every result is downloaded and sniffed like any other,
  because a scraper's idea of an image URL is a claim. A Google Custom
  Search provider over a hand-picked domain list was written and removed
  again in the same day: without a key it was a config branch and a test
  file for a worse version of this lane, and it is in the history if Serper
  ever goes away.
- **The Steam store** (`steam.ts`, keyless) leads the list on a games round:
  a search by title for the app, then the publisher's own screenshots at
  1920×1080. A screenshot is what a games round should show, and this is
  where they are for most PC games.
- **Wikipedia and Commons** (`wikimedia.ts`, keyless, two lanes): what is on
  the subject's English article, which is guaranteed to be *about* the
  subject, and what Commons holds under its name, which is ranked by
  relevance and the only archive for a subject with no article. The lanes
  are interleaved with the web's so no single source spends the whole list;
  filling from the article first showed twelve incidental photographs and
  never the cosplay shot Commons had ranked first.

**The lookup finds; the model chooses; the judge looks.** That split is the
design. A tool that picked would have to know that a wordmark ruins a logo
round, that a poster spells a film's title out, that box art is not a
screenshot — judgements the prompt makes and an API cannot. What the tool
does is make every candidate URL real, which is the half the model was bad
at, and what `vision.ts` does is catch the choices the prompt's rules could
not: **every download is shown to a vision model** (`DEEPSEEK_VISION_MODEL`,
`deepseek-v4-flash-vision-exp` by default, on the same key, a few hundred
tokens a picture) with the subject, the question and every answer and alias
in every language, and asked for the readable text, whether the subject is
large and plain, and whether anything gives it away. The decision is made on
this side, in `decide`: a picture is refused on the model's own verdict *and*
on its transcript naming an answer — folded and matched on word boundaries,
so "Up" is not found in "level up" — because a model asked "does this give it
away?" is lenient about a title it has just read. An SVG cannot be shown to
it and is read instead, its `<text>` checked the same way. The check is a
guard, not a dependency: the endpoint is experimental, so a check that cannot
be made — the model gone, a reply that is not JSON — lets the picture through
*unverified* with a line in the log, and `DEEPSEEK_VISION_MODEL=` (empty)
turns it off on purpose. The rules that make a round good have not moved into
the judge; the prompt still says a game is a mid-game screenshot and never
its cover, a film or a series is a frame and never its poster, a YouTuber
is a face and never a thumbnail, a logo is the symbol alone — the judge is
what makes those rules cost something when they are broken.

Image rounds still return up to five candidate URLs, best first, and the
first that downloads as an actual image *and passes the judge* wins
(`candidates.ts`). URLs the lookup showed go first, in the model's order, and
any the model wrote itself go last rather than being dropped — the rule is
"copy from the results", but a URL that turns out to exist is still a
picture. Every refusal is kept with its reason, because the retry note has to
say what was wrong with *each*: pictures that were looked at and refused are
listed with why, so the second attempt picks a different picture rather than
the same poster; URLs that never downloaded at all get the lookup run again
on this side and the real URLs quoted into the note, so the retry works even
when the model skipped the tool. Lyrics rounds involve no URLs and no lookup:
a paraphrase is written from what the model already knows.

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

**A miss is told to the guesser and to nobody else.** It is one of two things
in this game that do not ride in the snapshot — the other is a vote, see Rating
a Round — which is what lets the field clear and shake without the room being
shown who fumbled it. A *correct* answer is
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

## Rating a Round

Once the answer is up, every player may say whether that was a good one:
thumbs up or thumbs down, beside the answer on the reveal. It is about the
*round* — the picture, the paraphrase, the question — and not about whether
the player got it, which is why it sits next to the answer rather than next to
the score, and why it is asked of everybody rather than only of the people who
missed.

- **The window is the intermission.** `round:vote` quotes the round number
  the way a guess does and is accepted only while the lobby is in
  `intermission` on that round: before the reveal the player has not seen the
  whole round, and after `advance` the round is not on screen at all. Five
  seconds is short, and that is deliberate — a thumb is a reaction, and a
  rating nobody has time to read is a rating nobody gives.
- **One per seat, and the first one counts.** A second thumb is refused
  (`ALREADY_VOTED`) rather than swapped, so the buttons lock on the first tap
  with the chosen one lit. A control that could be toggled for five seconds
  would spend them on the control. `components/game/vote-buttons.tsx` is the
  island, keyed on the round number so the next reveal is a fresh pair, and
  it lights nothing the server has not confirmed.
- **The room hears nothing.** Like a miss, a vote is answered in the ack and
  never rides in the snapshot: what a player thought of a round is between
  them and the operator, and a tally on everybody's screen would turn a
  rating into a verdict on whoever picked the topic.
- **The bank keeps it.** `RoundRecord.bankId` is the bank's id for what is on
  screen, carried in from `SourcedRound.id`; `store.vote` decides that the
  thumb counts and hands back a `RoundVoteRecord` — round id, the lobby's
  language, the vote, the server's clock — which the adapter files through
  `RoundFeedback`, implemented in `bank/feedback.ts`: the write half of the
  seam `bank/source.ts` is the read half of. The write is made *behind* the
  ack: the player was told before the database was asked, and a bank that
  cannot take the row is a line in the log rather than a round that stalls.
  A round from a source with no ledger — a fixture in a test — is voted on
  and filed nowhere.
- **One row per thumb**, in `round_votes`, with the lobby's language and a
  timestamp, cascading with the round. Rows rather than two counters on
  `rounds`, because a round disliked only in German lobbies is a German
  question to fix rather than a picture to replace, and because a table that
  only ever grows by insert needs no lock. The admin reads the tally as
  `BankedRoundRecord.votes` — counted in the database, one query per page like
  the texts — and shows it: a thumbs column on the list, a sentence in the
  round page's ledger line, and `order=liked` or `order=disliked` on the
  list's address to read the shelf by it, most first, the other thumb
  breaking ties and then newest. A ranking rather than a threshold, because
  the round worth a look is the top of a list and not a number an operator
  would know to type.

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
both sides read: fourteen topics, each carrying the `RoundKind` it produces.
Thirteen are `image`; `music` is the only `lyrics` topic, so a host who switches it
off has quietly turned the game into pictures only — which is why the mapping is
data rather than prose, and why the lobby can say so out loud.

Every lobby stores its own selection. All fourteen are on by default, at least one
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

Three long-running processes plus an on-demand service, in a pnpm workspace
driven by Turborepo:

```
apps/web/           # Next.js app. Renders UI. Holds no game state.
apps/game/          # Node + Socket.IO server. Owns all lobby state, in memory.
                    # Reads the round bank; carries nothing on disk.
apps/admin/         # Next.js app, behind a password. Reads and edits the round
                    # bank: the operator's view of every picture and paraphrase.
tools/fill/         # The fill service: the only process that calls the AI.
                    # Writes the round bank the game server reads.
packages/protocol/  # Shared TypeScript types for every socket event.
packages/bank/      # The round bank: repository, Drizzle schema, Postgres,
                    # S3 image store — the seam apps/game, tools/fill and
                    # apps/admin share instead of each other.
packages/ui/        # The design system: theme, fonts, every shadcn component
                    # and the wordmark — what apps/web and apps/admin render
                    # with instead of each carrying a copy.
```

`packages/protocol` and `packages/bank` compile to `dist`; turbo builds them
before anything that depends on them and keeps them in watch mode behind the
servers in dev. `packages/ui` has no build at all: it ships its `.tsx` source
and each Next app compiles it through `transpilePackages`, because a
`"use client"` directive, a `next/font` call and Tailwind's class scanning
all want the source rather than an emit of it. Everything runs from the root:
`pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` — and
`pnpm fill`, which runs the fill service until Ctrl+C. Each is a turbo task
graph, so a package is only rebuilt when its own inputs change.

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
built from it. The admin is a third deployable on the same database and
bucket, plus `ADMIN_PASSWORD`; it is optional, and nothing else knows
whether it is running.

**Dev:** `pnpm dev` at the root runs all three — web on :3000, game server on
:3001, admin on :3002. The client connects via `NEXT_PUBLIC_SOCKET_URL`.
Socket.IO gets an explicit origin allowlist, never `*`.

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
`CORS_ORIGINS`, `DATABASE_URL`, the four `S3_*` variables, `PUBLIC_BASE_URL`
and `ADMIN_PASSWORD` are listed under `passThroughEnv` on `dev` and `start`,
and `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`,
`DEEPSEEK_VISION_MODEL`, `SERPER_API_KEY`,
`DATABASE_URL` and the same `S3_*` on `fill` — passed through
rather than hashed, because they are runtime configuration and some of them
are secrets. A new runtime variable has to be added there or it will silently
go missing.

The admin reads its configuration the Next way — `apps/admin/.env` is loaded
by Next itself — and then, in `lib/config.ts`, reads `apps/game/.env` as a
fallback for the bank's whereabouts, exactly as the fill tool does and for
the same reason. `ADMIN_PASSWORD` has no fallback: it is the admin's alone.

**Lobbies are memory; content is an asset.** Lobby state lives in the game
server's process and dies with it — deliberately, see Lobbies. The round bank
persists: Postgres, through Drizzle, behind the `RoundRepository` interface
in `packages/bank` — written async so what is behind it stays swappable for
one new file rather than a change to any caller. Nothing outside
`packages/bank` knows what is plugged in. Three tables: `rounds` is what was photographed and
how often it has been dealt, `round_texts` is what each language asks and
accepts about it, and `round_votes` is what the players thought of it — the
one thing the game server writes back, see Rating a Round. The server, the fill service and the admin are three
processes on the one database, so `insert` — and the admin's `update` —
check and write under a transaction-scoped advisory lock on the topic:
polite writers instead of surprised ones.

## Admin

`apps/admin` is the back room: a Next.js app that reads the bank as a shelf
and lets an operator change what is on it. It is the **third process on the
one database and the one bucket** — it depends on `@guessly/bank` exactly as
the game server and the fill tool do, and on nothing of theirs. It never
generates a round: what it can do is see, fix, replace and remove.

**Behind one password.** `ADMIN_PASSWORD` is required, and `proxy.ts` stands
at the door for every request but the login page's own: a signed session
cookie or nothing. The cookie carries no secret — an expiry stamped with an
HMAC keyed off the password (`lib/session.ts`, Web Crypto so the proxy and
the actions run the same code) — so it lasts a week, cannot be forged, and
changing the password signs everybody out. A page you are not signed in for
is sent to sign in and back; a picture or a form post is refused with a 401,
because a redirect is not an answer an `<img>` can act on. Every server
action checks again for itself, because a write that trusted the door alone
is one misconfigured matcher away from open.

**Pictures come from the admin's own origin**, at `/img/<hash>.<ext>` like the
game's, because the bucket is private and the admin holds the key. The route
streams the object and marks it `private, immutable`: content-addressed, so
forever, but behind a sign-in, so never a shared cache's to hand on.

**An edit is a patch that names only what changed.** `lib/form.ts` reads the
editor's form against the round as it is and emits the difference — a pure
function, so what counts as a valid round is argued in a test and the
sentence it refuses with is the sentence the operator reads. The rules:

- **A language is present when it has a question and an answer.** Clearing
  both drops it; filling both on an empty card adds it — which is the manual
  backfill the Open Questions describe. A half-written card is refused by
  name, and so is a form that would leave no language at all.
- **An edit cannot make a duplicate.** `update` checks a changed answer
  against the topic's shelf in that language the way `insert` does, and
  refuses whole, naming the round in the way. Moving a round to another
  topic re-checks every language against the new shelf.
- **A round cannot change what it shows.** `RoundPatch` has no `kind`, and
  the editor only offers topics of the round's own kind: a picture that
  should have been lyrics is a round to delete and refill.
- **Limits are the fill parser's.** Subject, question, answer, alias count
  and snippet length mirror `tools/fill/src/content/schema.ts`, because an
  operator's round has to fit the same stage the model's does.

**A replaced picture goes through the same check as a downloaded one.**
`sniffImage` and `MAX_IMAGE_BYTES` moved from the fill tool into the bank
for this: what the bank will hold is the bank's rule, and an upload is
verified by its bytes, never by its name or the browser's type. The new
object is saved, the round is pointed at it, and the old one is deleted
only when `imageReferences` says no other round shows it — content
addressing means two rounds with the same bytes share one object.
**Deleting a round** takes its texts by cascade and its picture by the same
rule. The bucket's housekeeping is logged rather than shown when it fails:
the round was already saved or already gone, and that is the news.

**Several rounds go the same way, from the list.** Every row on `/rounds`
carries a checkbox and the table is a form around them: tick what should
go — or the header's box for the whole page — and the same two clicks the
single round's delete takes remove them in one call. `deleteMany` is the
repository's, one transaction for however many were ticked, and it hands
back what it actually removed, so a round somebody else deleted in the
meantime is a number in the notice rather than a failure; the pictures are
tidied once each afterwards, because two of the ticked rounds may have
shown the same one. The selection is the browser's — native checkboxes
named `id`, the rows still rendered on the server — and the one island
(`round-selection.tsx`) keeps only how many are ticked, counted off the
form on every change, never a second list of ids.

**The bank is loaded, not bundled.** `@guessly/bank` finds its migrations
relative to its own file, and a copy of it inside a Next chunk would look for
them beside the chunk. `serverExternalPackages` cannot keep a workspace
package out of the bundle — it only reaches packages that live in
`node_modules` for real — so `lib/bank.ts` is the one place the package's
values are imported, with a native `import()` both bundlers are told to leave
alone. Everything else imports its *types*, which cost nothing. The bank is
opened on the first request that needs it and parked on `globalThis`, because
`next dev` reloads server modules on every edit and a module variable would
be a fresh pool, a fresh `HeadBucket` and a fresh migration run each time.

**The filter is the URL.** `/rounds?topic=…&kind=…&language=…&q=…&order=…&page=…`
is read and written by `lib/query.ts` alone, so a page of rounds is a link
and the filter form is a plain GET form: the URL is its state, the browser
does the submitting, and the only script in it is shadcn's Select on the
four dropdowns, which carries its choice into the GET through the hidden
native `<select>` Radix renders beside it. The
language question has four answers — written in one, or missing one — and
the shelves page links straight to the missing ones, because a round
missing German is a job, not a statistic. `order` is the one parameter that
narrows nothing: the list is newest first unless it says `liked` or
`disliked`, and then it is the same list — same filter, same total — ranked
by that thumb, with the votes column marked `aria-sort` to say so. The
ranking is the repository's (`RoundOrder`, the third argument to `list`),
because it is a Postgres ORDER BY and not a sort of the page in hand. Pages
compose and hold nothing;
the islands are the forms, each around its own server action, and the
fields are uncontrolled with the round as their default, so the admin keeps
no copy of anything the server did not just send.

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
future screen can take the piece it needs: `packages/ui/src/components/ui/` is
shadcn-generated (never hand-edited — override at the call site with
`className`, so `shadcn add` keeps working), `components/site/` is chrome
shared across one app's screens, and `components/<route>/` is route-specific.
Markup uses the real element —
`<main>`, `<footer>`, `<form>`, `<label>`, `<ol>` — and anything purely
decorative is `aria-hidden` so it does not narrate a fake scoreboard to a screen
reader.

**The design system is a package, and nothing in it is copied.** `@guessly/ui`
holds what both Next apps would otherwise carry twice: the theme
(`src/styles/globals.css`), the two faces (`src/fonts.ts`), `cn`, every
shadcn component and the wordmark. A root layout imports the stylesheet and
puts `fontVariables` on `<html>`, and that is the whole of what an app does to
be dressed like Guessly — the admin is the game's own chrome in a different
room, and it got there without a second `globals.css` to drift. Three things
about the package are rules rather than layout:

- **Its stylesheet names its own components.** Tailwind scans from the app
  that compiles the CSS, and the package sits outside it, so the
  `@source "../components"` at the top of `globals.css` is what generates the
  classes the buttons are made of. Delete it and every control silently loses
  its styling rather than failing.
- **`shadcn add` is run in the package, never in an app.** `pnpm shadcn add
  <name>` at the root does exactly that: the package has its own
  `components.json`, so the file lands in `src/components/ui/` and whatever
  the registry item depends on lands in the package's `package.json`. Both
  apps' `components.json` still alias `ui` and `utils` to `@guessly/ui`, as
  shadcn's monorepo layout asks, but running the CLI *from* an app is a trap
  on Windows: it writes the file into the package and installs the dependency
  into the app, because its package-root lookup compares a backslash path
  against forward-slash glob output and never matches. Note that the current
  registry imports `cn` from shadcn's own `cn` npm package rather than from
  `lib/utils`; the components already here predate that, and both are the
  same helper. Whether `lib/utils` should simply re-export it is undecided.
- **A dependency a component needs is the package's.** `radix-ui`, `sonner`,
  `lucide-react` and the class helpers live in `packages/ui/package.json`; an
  app lists only what its *own* code imports (the web app still imports icons
  and `toast` directly). Chrome that is genuinely one app's — the site header,
  the admin header, its `Field` — stays in that app's `components/`.

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

**Design system:** dark only, tokens in `packages/ui/src/styles/globals.css` —
read the comments there before touching a value, and run `pnpm test` after: the
contrast guard (`theme-contrast.test.ts`) lives beside the stylesheet, in the
package. The yellow `--primary` is the single call to action on a screen;
`--brand-cyan` and `--brand-pink` are decorative only (rules, indicators,
plates), never text and never a hover surface.

The browse list is the one screen with more than one yellow button, and it is
not an exception to the rule so much as the rule read literally: every joinable
row *is* the call to action, and picking which room to walk into is the only
thing the page is for. A row that cannot be joined drops back to `secondary`,
so the yellow still marks exactly what a click will do.

**Sound is garnish, and one voice.** Four sounds — countdown tick, GO, right,
wrong — all from one CC0 pack (Kenney's Interface Sounds, see
`public/sounds/README.md`), so they read as a set rather than four apps
talking at once. Three of them are one voice literally: GO, a score and a miss
are a single soft chime played as a gesture — rising low, rising an octave and a
half higher, and inverted to fall — so the room's three verdicts are one sound
in three readings, and up-is-yes needs no learning. The tick stands outside it
on purpose, being percussion rather than a fourth note, because it plays six
times a round.

**A sound is harsh because of where it sits, not how loud it is.** The first
set was chosen for meaning alone and was shrill: the miss put 44% of its energy
above 2kHz and 24% above 4kHz — a thin metallic buzz that cuts through at almost
no measured level — and the tick sat at 1.9kHz, the peak of hearing sensitivity,
six times a round. The set that replaced it has *no* energy above 2kHz at all,
and `sounds.ts` balances the four by A-weighted loudness rather than by peak,
since the files are all normalised to the same peak and a peak is not what
anybody hears. Turning the volume down would not have fixed the first set, which
is why the register is a rule and not a preference: a replacement sound has to
be checked for where it sits, not only for sounding like the right event.

`lib/sounds.ts` owns playback: Web Audio for latency, the context unlocked on
the first gesture anywhere because the countdown itself is not one, and
`playSound` degrading to silence — never an error, never a queue — when audio
is unavailable. A verdict sound plays only where the verdict is told: the
wrong-sound rides the same one-person ack as the shake, so the room hears who
scored and never who fumbled.

**The tick counts a round out as well as in.** The last three seconds of the
twenty get one a second — the same low bong, not a fifth file, because it is
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
| `round:vote` | `{ roundNumber, vote }` — `vote` is `up` or `down`; while `intermission`, once per seat | `{}` |
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
`round:guess` and `round:vote` are the exceptions: a guess is several a round
per player, and its ack is the only place a *wrong* guess is ever reported; a
vote's ack is the only place a vote is reported at all.

**The server owns the clock.** It stamps when each guess *arrives*, and clients
render their countdown from a server-sent deadline. Client timestamps are never
trusted — speed is the score here.

**Errors:** `LOBBY_NOT_FOUND`, `LOBBY_FULL`, `GAME_IN_PROGRESS`, `NICKNAME_TAKEN`,
`INVALID_NICKNAME`, `INVALID_TARGET_SCORE`, `INVALID_TOPICS`, `INVALID_LANGUAGE`,
`NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `ROUND_NOT_OPEN`, `ALREADY_ANSWERED`, `INVALID_GUESS`,
`ALREADY_VOTED`, `INVALID_VOTE`, `RATE_LIMITED`, `SERVER_ERROR`, and `RESUME_REJECTED` — on which the client
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
out of players, the scoring of a guess, and who may vote on a round and when —
under fast deterministic unit tests
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
than a throw, and through each provider's own parsing — a real API payload
read into candidates, which is where an article's sister-project logos and
20px interface icons (`wikimedia.ts`), a web result that is a thumbnail or
plain http (`serper.ts`) and a store entry that is the soundtrack rather
than the game (`steam.ts`) have to stop being offered as pictures of the
subject. `search.ts`'s merge, `vision.ts`'s decision — the transcript
overruling the model's own verdict — and `candidates.ts`'s known-first order
and reasons-kept loop are argued the same way, against stub providers and a
stub judge. All of them are pure functions of a payload, so none of the
tests touch the network; the one exception is the Serper provider's account
bench, which is tested against a stubbed `fetch` because an hour's rest
after a refusal is the behaviour and not the parsing. The bank is tested from all three of its ends, each in its own
package: `packages/bank`'s `postgres.test.ts` runs the real repository — the
same Drizzle queries and migrations as production — against PGlite, Postgres
compiled to WASM rather than an imitation of it, booted once per process and
wiped clean for every test, and `admin.test.ts` runs the admin's half of it
the same way — listing and searching, the edit that may not make a duplicate
or leave a round with no language, the deletions — one, or several in one
transaction — that hand back what they removed, the picture two rounds
share, and the votes, counted per round, ranked by either thumb and taken
with a deleted one; the game's `bank/source.test.ts`
drives the consuming side —
draws, cross-language aliases, and the misses that fail a round — against it;
and `tools/fill`'s `fill.test.ts` drives the producing side — thinnest shelf
first, exclusion lists, benching and backoff — with a stub generator and a
fake image store. The admin's own tests are the pure parts of it: `form.ts`,
where "would the bank take this round?" is argued sentence by sentence and
the list's checkboxes are read back into ids,
`query.ts`, where the URL round-trips, and `session.ts`, where a moved
expiry and a changed password are both refused.

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
- **Nothing backfills a language added later — automatically.** A new entry
  in the catalogue is all the schema, the tool and the UI need — but every
  round already banked was written without it, and `draw` passes those over,
  so the new language starts on an empty shelf and fills only as it is
  played. The admin shows the queue (`/rounds?language=missing:<id>`) and
  lets an operator write the missing text one round at a time; a backfill
  pass that asked the generator for it instead would be cheap and is
  unwritten. Whether it is worth writing depends on how often a language is
  added, which is so far never.
- **Every lobby is listed, and none of them chose to be.** `/lobbies` shows
  whatever exists, so a group who only meant to play among themselves is
  discoverable by a stranger who reloads at the right moment. Nothing is opened
  that the code did not already open — joining is unchanged, and a started or
  full lobby still refuses — but an unlisted flag is an obvious thing to want
  and is unwritten. Whether it is worth having depends on whether strangers turn
  out to be the point of the page or the problem with it.
- **The bank has no curator but a person.** The admin lets an operator retire
  a round, add an alias and see how often each round has been dealt — but
  nothing *automatic* retires a round nobody solves or nobody liked, turns
  near-miss guesses into aliases, or decides how deep a topic's shelf
  *should* be: the fill tool fills evenly for as long as it runs. The votes
  are kept now (see Rating a Round) and the admin shows them, with the most
  disliked rounds a sort away — but a person still has to look; the rest of
  the play data — who solved a round, and how fast — is still thrown away at
  reveal.
- **The admin creates nothing.** It edits, replaces and deletes, and the fill
  tool is still the only way a round is born. A hand-made round — a picture
  uploaded from scratch with its texts typed in — is the obvious next thing
  the editor could do and is unwritten; whether it is worth writing depends
  on whether the fill tool's misses turn out to be fixable ones.
