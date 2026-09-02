import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as connectClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALL_TOPIC_IDS,
  IDLE_LOBBY_TTL_MS,
  INTERMISSION_DURATION_MS,
  RATE_LIMIT_EVENTS_PER_SEC,
  ROUND_MAX_POINTS,
  type Ack,
  type CreateLobbyResult,
  type GuessResult,
  type JoinLobbyResult,
  type LobbyClosedPayload,
  type LobbyState,
  type RoundContent,
} from "@guessly/protocol";
import {
  RoundSourceError,
  type RoundContentSource,
  type SourcedRound,
} from "../content/source.js";
import { createLobbyStore, type LobbyStore } from "../lobby/store.js";
import { registerSocketHandlers, type GameServer, type SocketAdapter } from "./register.js";

let httpServer: HttpServer;
let io: GameServer;
let store: LobbyStore;
let adapter: SocketAdapter;
let content: StubSource;
let url: string;
let clock: number;
const clients: ClientSocket[] = [];

beforeEach(async () => {
  clock = 1_700_000_000_000;
  httpServer = createServer();
  io = new Server(httpServer);
  store = createLobbyStore({ now: () => clock });
  content = stubSource();
  adapter = registerSocketHandlers(io, store, content.source);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of clients) client.disconnect();
  clients.length = 0;
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

async function connect(): Promise<ClientSocket> {
  const client = connectClient(url, { transports: ["websocket"], forceNew: true });
  clients.push(client);
  await new Promise<void>((resolve) => client.on("connect", () => resolve()));
  return client;
}

function emit<T>(client: ClientSocket, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    if (payload === undefined) client.emit(event, resolve);
    else client.emit(event, payload, resolve);
  });
}

function nextEvent<T>(client: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => client.once(event, resolve as (value: unknown) => void));
}

/**
 * The next snapshot that looks like the one being waited for. A round can
 * produce several in a row — a guess lands, then the reveal it completed — and
 * `nextEvent` would catch whichever came first.
 */
function stateWhere(
  client: ClientSocket,
  matches: (state: LobbyState) => boolean,
): Promise<LobbyState> {
  return new Promise((resolve) => {
    const listen = (state: LobbyState): void => {
      if (!matches(state)) return;
      client.off("lobby:state", listen);
      resolve(state);
    };
    client.on("lobby:state", listen);
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

interface StubSource {
  source: RoundContentSource;
  /** Answers whatever round is currently being asked for. */
  deliver(round: SourcedRound): void;
  fail(message: string): void;
}

/**
 * The content source, under the test's control.
 *
 * Nothing here waits three real seconds for a countdown: the store's clock is
 * pinned to a fixed instant well in the past, so the deadline it stamps on the
 * round is already behind the runner's real clock and the countdown timer fires
 * on the next tick. What is being tested is the wiring — who gets told what —
 * and the timing itself is covered deterministically in the store's own tests.
 */
function stubSource(): StubSource {
  let settleRound: ((round: SourcedRound) => void) | null = null;
  let failRound: ((error: Error) => void) | null = null;

  return {
    source: {
      build: () =>
        new Promise<SourcedRound>((resolve, reject) => {
          settleRound = resolve;
          failRound = reject;
        }),
    },
    deliver: (round) => settleRound?.(round),
    fail: (message) => failRound?.(new RoundSourceError(message)),
  };
}

const A_PICTURE: RoundContent = {
  kind: "image",
  question: "Which country's flag is this?",
  imageUrl: "https://example.test/flag.png",
};

/** A host and a guest, both in, ready for the host to press start. */
async function readyToStart() {
  const { host, created } = await openLobby();
  const guest = await connect();
  await emit<JoinLobbyResult>(guest, "lobby:join", {
    code: created.code,
    nickname: "kim",
  });
  return { host, guest, created };
}

function unwrap<T>(result: Ack<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.message}`);
  return result.data;
}

/** A host on their own socket, with the lobby already open. */
async function openLobby() {
  const host = await connect();
  const created = unwrap(
    await emit<CreateLobbyResult>(host, "lobby:create", {
      nickname: "host",
      targetScore: 100,
      topics: [...ALL_TOPIC_IDS],
    }),
  );
  return { host, created };
}

describe("creating and joining", () => {
  it("answers the creator with a seat and a token", async () => {
    const { created } = await openLobby();

    expect(created.code).toHaveLength(5);
    expect(created.resumeToken).toHaveLength(64);
    expect(created.state.hostId).toBe(created.playerId);
    expect(created.state.topics).toEqual([...ALL_TOPIC_IDS]);
  });

  it("pushes the new snapshot to everybody already in the lobby", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();

    const broadcast = nextEvent<LobbyState>(host, "lobby:state");
    await emit<JoinLobbyResult>(guest, "lobby:join", { code: created.code, nickname: "kim" });

    expect((await broadcast).players.map((player) => player.nickname)).toEqual(["host", "kim"]);
  });

  it("answers an unknown code with an error rather than throwing", async () => {
    const guest = await connect();
    const result = await emit(guest, "lobby:join", { code: "ZZZZZ", nickname: "kim" });

    expect(result).toMatchObject({ ok: false, error: "LOBBY_NOT_FOUND" });
  });

  it("survives a payload that is not even the right shape", async () => {
    const guest = await connect();

    expect(await emit(guest, "lobby:create", "not an object")).toMatchObject({ ok: false });
    expect(await emit(guest, "lobby:join", { code: 12 })).toMatchObject({
      ok: false,
      error: "LOBBY_NOT_FOUND",
    });
    expect(
      await emit(guest, "lobby:create", {
        nickname: "kim",
        targetScore: 100,
        topics: ["not-a-topic"],
      }),
    ).toMatchObject({ ok: false, error: "INVALID_TOPICS" });
    expect(
      await emit(guest, "lobby:create", { nickname: "kim", targetScore: 100, topics: "flags" }),
    ).toMatchObject({ ok: false, error: "INVALID_TOPICS" });
    expect(await emit(guest, "lobby:create", { nickname: "kim", targetScore: "lots" })).toMatchObject(
      { ok: false, error: "INVALID_TARGET_SCORE" },
    );
  });
});

describe("host powers", () => {
  it("broadcasts a new target score", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    const broadcast = nextEvent<LobbyState>(guest, "lobby:state");
    expect(await emit(host, "lobby:setTarget", { targetScore: 250 })).toMatchObject({ ok: true });
    expect((await broadcast).targetScore).toBe(250);
  });

  it("broadcasts a new topic selection", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    const broadcast = nextEvent<LobbyState>(guest, "lobby:state");
    expect(await emit(host, "lobby:setTopics", { topics: ["music", "flags"] })).toMatchObject({
      ok: true,
    });
    expect((await broadcast).topics).toEqual(["flags", "music"]);
  });

  it("refuses a guest who tries to re-pick the topics", async () => {
    const { created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    expect(await emit(guest, "lobby:setTopics", { topics: ["flags"] })).toMatchObject({
      ok: false,
      error: "NOT_HOST",
    });
  });

  it("refuses a guest who tries to start the game", async () => {
    const { created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    expect(await emit(guest, "lobby:start")).toMatchObject({ ok: false, error: "NOT_HOST" });
  });

  it("refuses a socket that is not in a lobby at all", async () => {
    const stranger = await connect();
    expect(await emit(stranger, "lobby:start")).toMatchObject({
      ok: false,
      error: "LOBBY_NOT_FOUND",
    });
  });
});

describe("starting a round", () => {
  it("puts everybody on a countdown with nothing to look at yet", async () => {
    const { host, guest } = await readyToStart();

    const seen = [nextEvent<LobbyState>(host, "lobby:state"), nextEvent<LobbyState>(guest, "lobby:state")];
    expect(await emit(host, "lobby:start")).toMatchObject({ ok: true });

    for (const state of await Promise.all(seen)) {
      expect(state.status).toBe("countdown");
      expect(state.round).toMatchObject({ number: 1, content: null, answer: null });
    }
  });

  it("shows the same round to everybody when the content lands", async () => {
    const { host, guest } = await readyToStart();
    await emit(host, "lobby:start");
    await settle();

    const seen = [nextEvent<LobbyState>(host, "lobby:state"), nextEvent<LobbyState>(guest, "lobby:state")];
    content.deliver({
      content: A_PICTURE,
      answer: "Bhutan",
      aliases: ["Kingdom of Bhutan"],
      subject: "Flag of Bhutan",
    });

    for (const state of await Promise.all(seen)) {
      expect(state.status).toBe("in_round");
      expect(state.round?.content).toEqual(A_PICTURE);
      // Nobody is told the answer while there is still time to type it.
      expect(state.round?.answer).toBeNull();
    }
  });

  it("retries a failed round on a fresh topic before giving up", async () => {
    const { host, guest } = await readyToStart();
    await emit(host, "lobby:start");
    await settle();

    // First failure: the round is reopened, not abandoned — the room sees a
    // fresh countdown and hears no round:failed.
    const reopened = nextEvent<LobbyState>(host, "lobby:state");
    content.fail("None of the pictures the AI picked would load.");
    expect((await reopened).status).toBe("countdown");
    await settle();

    // The retry asked the source again; this time the content arrives.
    const live = stateWhere(guest, (state) => state.status === "in_round");
    content.deliver({
      content: A_PICTURE,
      answer: "Bhutan",
      aliases: [],
      subject: "Flag of Bhutan",
    });
    expect((await live).round?.content).toEqual(A_PICTURE);
  });

  it("sends everybody back to the lobby when the retry fails too", async () => {
    const { host, guest } = await readyToStart();
    await emit(host, "lobby:start");
    await settle();

    content.fail("None of the pictures the AI picked would load.");
    await settle();

    const explained = nextEvent<{ message: string }>(guest, "round:failed");
    const state = stateWhere(host, (snapshot) => snapshot.status === "lobby");
    content.fail("None of the pictures the AI picked would load.");

    expect((await explained).message).toBe("None of the pictures the AI picked would load.");
    expect((await state).round).toBeNull();
  });
});

/**
 * Host and guest both in, with round one live and genuinely open.
 *
 * The clock moves forward here, and that is the point of this helper. Up to
 * the delivery the store's pinned instant is well in the past, so the
 * countdown's deadline is already behind the runner's real clock and fires on
 * the next tick — the same trick the rest of this file relies on. A round
 * that has to be guessed at cannot be stamped that way: its deadline has to
 * be somewhere ahead, or the reveal races the first guess.
 *
 * The moment round one goes live the runner also asks the source for round
 * two, so from here on the stub's pending request is the *prefetch* — a
 * `deliver` or `fail` now answers round two, not round one.
 */
async function playing() {
  const table = await readyToStart();
  await emit(table.host, "lobby:start");
  await settle();

  // Awaited on both sockets, not just the host's: the delivery snapshot goes
  // to the whole room, and a test that only waits for one copy of it goes on
  // to mistake the other for whatever it does next.
  const live = [
    nextEvent<LobbyState>(table.host, "lobby:state"),
    nextEvent<LobbyState>(table.guest, "lobby:state"),
  ];
  clock = Date.now();
  content.deliver({
    content: A_PICTURE,
    answer: "Bhutan",
    aliases: ["Kingdom of Bhutan"],
    subject: "Flag of Bhutan",
  });
  await Promise.all(live);
  return table;
}

describe("guessing", () => {
  it("tells the guesser they were wrong and tells nobody else anything", async () => {
    const { host, guest } = await playing();

    let overheard = false;
    guest.on("lobby:state", () => {
      overheard = true;
    });

    const result = await emit<GuessResult>(host, "round:guess", {
      roundNumber: 1,
      guess: "Nepal",
    });

    expect(unwrap(result)).toEqual({ correct: false });
    await settle();
    expect(overheard).toBe(false);
  });

  it("puts a correct answer on everybody's scoreboard", async () => {
    const { host, guest, created } = await playing();

    const broadcast = nextEvent<LobbyState>(guest, "lobby:state");
    const result = unwrap(
      await emit<GuessResult>(host, "round:guess", { roundNumber: 1, guess: "bhutan" }),
    );
    expect(result).toMatchObject({ correct: true, points: ROUND_MAX_POINTS });

    const state = await broadcast;
    expect(state.round?.results).toEqual([
      {
        playerId: created.playerId,
        elapsedMs: expect.any(Number),
        points: ROUND_MAX_POINTS,
      },
    ]);
    expect(state.players[0]?.score).toBe(ROUND_MAX_POINTS);
    // The round is still open, so still nobody has been told the answer.
    expect(state.round?.answer).toBeNull();
  });

  it("accepts an alias", async () => {
    const { host } = await playing();
    expect(
      unwrap(
        await emit<GuessResult>(host, "round:guess", {
          roundNumber: 1,
          guess: "Kingdom of Bhutan",
        }),
      ),
    ).toMatchObject({ correct: true });
  });

  it("refuses a second answer from a seat that already has one", async () => {
    const { host } = await playing();
    await emit(host, "round:guess", { roundNumber: 1, guess: "Bhutan" });

    expect(await emit(host, "round:guess", { roundNumber: 1, guess: "Bhutan" })).toMatchObject({
      ok: false,
      error: "ALREADY_ANSWERED",
    });
  });

  it("survives a payload that is not even the right shape", async () => {
    const { host } = await playing();

    expect(await emit(host, "round:guess", "Bhutan")).toMatchObject({
      ok: false,
      error: "ROUND_NOT_OPEN",
    });
    expect(await emit(host, "round:guess", { roundNumber: 1, guess: 12 })).toMatchObject({
      ok: false,
      error: "INVALID_GUESS",
    });
  });

  it("refuses a stranger who is not in a lobby at all", async () => {
    await playing();
    const stranger = await connect();
    expect(await emit(stranger, "round:guess", { roundNumber: 1, guess: "Bhutan" })).toMatchObject({
      ok: false,
      error: "LOBBY_NOT_FOUND",
    });
  });

  it("reveals early once everybody present has answered", async () => {
    const { host, guest } = await playing();
    await emit(host, "round:guess", { roundNumber: 1, guess: "Bhutan" });

    // Nineteen seconds still on the clock, and nobody left to spend them on.
    const revealed = stateWhere(guest, (state) => state.status === "intermission");
    await emit(guest, "round:guess", { roundNumber: 1, guess: "Bhutan" });

    const state = await revealed;
    expect(state.round?.answer).toBe("Bhutan");
    expect(state.round?.results).toHaveLength(2);
  });

  it("opens the next round's countdown when the intermission is up", async () => {
    const { host, guest } = await playing();
    await emit(host, "round:guess", { roundNumber: 1, guess: "Bhutan" });

    // Wound back, so the intermission the reveal is about to stamp is already
    // behind the runner's real clock and its timer fires at once. How long the
    // gap actually is is covered deterministically in the store's own tests;
    // what is under test here is that the chain links up at all.
    clock = Date.now() - INTERMISSION_DURATION_MS;

    const opened = stateWhere(host, (state) => state.round?.number === 2);
    await emit(guest, "round:guess", { roundNumber: 1, guess: "Bhutan" });

    const state = await opened;
    expect(state.status).toBe("countdown");
    expect(state.round).toMatchObject({ number: 2, content: null, results: [] });
    // And the scores from round one came with them.
    expect(state.players[0]?.score).toBe(ROUND_MAX_POINTS);
  });
});

describe("prefetching the next round", () => {
  const ROUND_TWO: SourcedRound = {
    content: {
      kind: "image",
      question: "Which country's flag is this?",
      imageUrl: "https://example.test/flag-two.png",
    },
    answer: "Japan",
    aliases: ["Nippon"],
    subject: "Flag of Japan",
  };

  /** Round one answered by everybody, with the clock wound back so the reveal,
   *  the intermission and the next countdown all fire at once. */
  async function playRoundOneOut(host: ClientSocket, guest: ClientSocket) {
    await emit(host, "round:guess", { roundNumber: 1, guess: "Bhutan" });
    clock = Date.now() - INTERMISSION_DURATION_MS;
    await emit(guest, "round:guess", { roundNumber: 1, guess: "Bhutan" });
  }

  it("plays round two from content fetched during round one", async () => {
    const { host, guest } = await playing();
    // Round two's request went out the moment round one went live; answer it
    // while round one is still on everybody's screen.
    content.deliver(ROUND_TWO);
    await settle();

    const live = stateWhere(
      guest,
      (state) => state.status === "in_round" && state.round?.number === 2,
    );
    await playRoundOneOut(host, guest);

    expect((await live).round?.content).toEqual(ROUND_TWO.content);
  });

  it("builds round two against its countdown when the prefetch failed", async () => {
    const { host, guest } = await playing();
    content.fail("the prefetch went wrong");
    await settle();

    const opened = stateWhere(
      guest,
      (state) => state.status === "countdown" && state.round?.number === 2,
    );
    await playRoundOneOut(host, guest);
    await opened;
    // The fallback request has gone out by now; answering it is what makes the
    // round — the failed prefetch cost nothing but the head start.
    await settle();

    const live = stateWhere(
      guest,
      (state) => state.status === "in_round" && state.round?.number === 2,
    );
    content.deliver(ROUND_TWO);
    expect((await live).round?.content).toEqual(ROUND_TWO.content);
  });
});

describe("join, drop, resume", () => {
  it("greys the seat out on the drop and restores it on the resume", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    const joined = unwrap(
      await emit<JoinLobbyResult>(guest, "lobby:join", { code: created.code, nickname: "kim" }),
    );

    const dropped = nextEvent<LobbyState>(host, "lobby:state");
    guest.disconnect();
    expect((await dropped).players[1]).toMatchObject({ connected: false });

    const returning = await connect();
    const restored = nextEvent<LobbyState>(host, "lobby:state");
    const resumed = unwrap(
      await emit<{ state: LobbyState }>(returning, "lobby:resume", {
        code: created.code,
        playerId: joined.playerId,
        resumeToken: joined.resumeToken,
      }),
    );

    expect(resumed.state.players[1]).toMatchObject({ connected: true, disconnectedAt: null });
    expect((await restored).players[1]).toMatchObject({ connected: true });
  });

  it("refuses a resume without the right token", async () => {
    const { created } = await openLobby();
    const guest = await connect();
    const joined = unwrap(
      await emit<JoinLobbyResult>(guest, "lobby:join", { code: created.code, nickname: "kim" }),
    );

    const thief = await connect();
    expect(
      await emit(thief, "lobby:resume", {
        code: created.code,
        playerId: joined.playerId,
        resumeToken: "f".repeat(64),
      }),
    ).toMatchObject({ ok: false, error: "RESUME_REJECTED" });
  });

  it("evicts the old socket when a seat is reclaimed, without dropping the seat", async () => {
    const { created } = await openLobby();
    const guest = await connect();
    const joined = unwrap(
      await emit<JoinLobbyResult>(guest, "lobby:join", { code: created.code, nickname: "kim" }),
    );

    // The tab was reopened before the old one noticed it was gone.
    const reopened = await connect();
    const evicted = nextEvent(guest, "disconnect");
    await emit(reopened, "lobby:resume", {
      code: created.code,
      playerId: joined.playerId,
      resumeToken: joined.resumeToken,
    });

    await evicted;
    await settle();
    expect(store.snapshot(created.code)?.players[1]?.connected).toBe(true);
  });

  it("hands the lobby on when the host drops", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    const joined = unwrap(
      await emit<JoinLobbyResult>(guest, "lobby:join", { code: created.code, nickname: "kim" }),
    );

    const promoted = nextEvent<LobbyState>(guest, "lobby:state");
    host.disconnect();
    expect((await promoted).hostId).toBe(joined.playerId);
  });
});

describe("leaving", () => {
  it("frees the seat and tells everybody left", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    const broadcast = nextEvent<LobbyState>(host, "lobby:state");
    expect(await emit(guest, "lobby:leave")).toMatchObject({ ok: true });
    expect((await broadcast).players).toHaveLength(1);
  });

  it("does not then report the same player as disconnected", async () => {
    const { created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    await emit(guest, "lobby:leave");
    guest.disconnect();
    await settle();

    expect(store.snapshot(created.code)?.players).toHaveLength(1);
  });
});

describe("the sweep", () => {
  it("tells the room the lobby is gone", async () => {
    const { host, created } = await openLobby();
    const guest = await connect();
    await emit(guest, "lobby:join", { code: created.code, nickname: "kim" });

    const closed = nextEvent<LobbyClosedPayload>(host, "lobby:closed");
    clock += IDLE_LOBBY_TTL_MS;
    adapter.sweep();

    expect(await closed).toEqual({ reason: "idle" });
    expect(store.size()).toBe(0);
  });
});

describe("the rate limiter", () => {
  it("refuses a flood without dropping the connection", async () => {
    const client = await connect();
    const flood = RATE_LIMIT_EVENTS_PER_SEC + 15;

    const results = await Promise.all(
      Array.from({ length: flood }, () => emit(client, "lobby:leave")),
    );
    const limited = results.filter((result) => !result.ok && result.error === "RATE_LIMITED");

    expect(limited.length).toBeGreaterThan(0);
    expect(results.filter((result) => result.ok).length).toBeLessThanOrEqual(
      RATE_LIMIT_EVENTS_PER_SEC,
    );
    expect(client.connected).toBe(true);
  });
});
