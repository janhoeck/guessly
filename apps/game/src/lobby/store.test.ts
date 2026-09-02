import { describe, expect, it } from "vitest";
import {
  COUNTDOWN_DURATION_MS,
  EMPTY_LOBBY_TTL_MS,
  IDLE_LOBBY_TTL_MS,
  INTERMISSION_DURATION_MS,
  LOBBY_DISCONNECT_GRACE_MS,
  MAX_PLAYERS_PER_LOBBY,
  ALL_TOPIC_IDS,
  MAX_TARGET_SCORE,
  MIN_TARGET_SCORE,
  ROUND_DURATION_MS,
  ROUND_MAX_POINTS,
  ROUND_MIN_POINTS,
  type Ack,
  type CreateLobbyPayload,
  type ErrorCode,
  type RoundContent,
  type TopicId,
} from "@guessly/protocol";
import { createLobbyStore } from "./store.js";

const NOON = 1_700_000_000_000;

/** A store with every source of nondeterminism pinned down. */
function testStore(...queuedCodes: string[]) {
  let now = NOON;
  const codes = [...queuedCodes];
  let codeCount = 0;
  let idCount = 0;
  let tokenCount = 0;
  /** Which topic a round draws. Zero is the first of the lobby's own selection. */
  let pick = 0;

  const store = createLobbyStore({
    now: () => now,
    generateCode: () => codes.shift() ?? `CODE${(codeCount += 1)}`,
    generatePlayerId: () => `player-${(idCount += 1)}`,
    generateToken: () => `token-${(tokenCount += 1)}`,
    pickIndex: () => pick,
  });

  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
    queueCodes: (...more: string[]) => codes.push(...more),
    pickTopicAt: (index: number) => {
      pick = index;
    },
  };
}

/** Stand-in for whatever the content source came back with. */
const A_PICTURE: RoundContent = {
  kind: "image",
  question: "Which country's flag is this?",
  imageUrl: "https://example.test/flag.png",
};

/**
 * A valid create payload with only the field under test varied, so a new
 * required field is one edit here rather than one per call site.
 */
function creating(overrides: Partial<CreateLobbyPayload> = {}): CreateLobbyPayload {
  return { nickname: "jan", targetScore: 100, topics: [...ALL_TOPIC_IDS], ...overrides };
}

function unwrap<T>(result: Ack<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}: ${result.message}`);
  return result.data;
}

function failure(result: Ack<unknown>): ErrorCode {
  if (result.ok) throw new Error("expected a failure, got ok");
  return result.error;
}

/** A lobby with `count` connected players. The first is the host. */
function lobbyOf(count: number) {
  const harness = testStore();
  const host = unwrap(harness.store.create(creating({ nickname: "host" })));
  const joiners = Array.from({ length: count - 1 }, (_, index) =>
    unwrap(harness.store.join({ code: host.code, nickname: `player${index + 2}` })),
  );
  return { ...harness, code: host.code, host, joiners };
}

describe("create", () => {
  it("seats the creator as a connected host on zero points", () => {
    const { store } = testStore("ABCDE");
    const created = unwrap(store.create(creating({ nickname: "jan" })));

    expect(created.code).toBe("ABCDE");
    expect(created.state.hostId).toBe(created.playerId);
    expect(created.state.status).toBe("lobby");
    expect(created.state.targetScore).toBe(100);
    expect(created.state.topics).toEqual([...ALL_TOPIC_IDS]);
    expect(created.state.players).toEqual([
      { id: created.playerId, nickname: "jan", score: 0, connected: true, disconnectedAt: null },
    ]);
  });

  it("trims the nickname", () => {
    const { store } = testStore();
    const created = unwrap(store.create(creating({ nickname: "  jan  " })));
    expect(created.state.players[0]?.nickname).toBe("jan");
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["too long", "x".repeat(17)],
    ["containing a newline", "ja\nn"],
  ])("rejects a nickname that is %s", (_label, nickname) => {
    const { store } = testStore();
    expect(failure(store.create(creating({ nickname })))).toBe("INVALID_NICKNAME");
  });

  it.each([MIN_TARGET_SCORE - 1, MAX_TARGET_SCORE + 1, 100.5, Number.NaN])(
    "rejects a target score of %s",
    (targetScore) => {
      const { store } = testStore();
      expect(failure(store.create(creating({ targetScore })))).toBe("INVALID_TARGET_SCORE");
    },
  );

  it("retries until it finds a free code", () => {
    const { store, queueCodes } = testStore("ABCDE");
    unwrap(store.create(creating({ nickname: "first" })));

    queueCodes("ABCDE", "ABCDE", "FGHJK");
    const second = unwrap(store.create(creating({ nickname: "second" })));

    expect(second.code).toBe("FGHJK");
    expect(store.size()).toBe(2);
  });

  it("gives up rather than looping forever when every code collides", () => {
    const { store, queueCodes } = testStore("ABCDE");
    unwrap(store.create(creating({ nickname: "first" })));

    queueCodes(...Array.from({ length: 500 }, () => "ABCDE"));
    expect(failure(store.create(creating({ nickname: "second" })))).toBe("SERVER_ERROR");
  });

  it("normalises the topic selection into catalogue order without duplicates", () => {
    const { store } = testStore();
    const created = unwrap(
      store.create(creating({ topics: ["music", "flags", "music"] })),
    );
    expect(created.state.topics).toEqual(["flags", "music"]);
  });

  it.each([
    ["empty", []],
    ["only duplicates of nothing", []],
    ["not a topic", ["flags", "quantum-physics"] as unknown as TopicId[]],
    ["not even a list", "flags" as unknown as TopicId[]],
  ])("rejects a topic selection that is %s", (_label, topics) => {
    const { store } = testStore();
    expect(failure(store.create(creating({ topics })))).toBe("INVALID_TOPICS");
  });
});

describe("join", () => {
  it("adds a player and returns the whole lobby", () => {
    const { store, code } = lobbyOf(1);
    const joined = unwrap(store.join({ code, nickname: "kim" }));

    expect(joined.state.players).toHaveLength(2);
    expect(joined.state.players[1]?.nickname).toBe("kim");
    expect(joined.state.hostId).toBe(joined.state.players[0]?.id);
  });

  it("accepts a code typed in lower case with stray spaces", () => {
    const { store, code } = lobbyOf(1);
    expect(store.join({ code: `  ${code.toLowerCase()} `, nickname: "kim" }).ok).toBe(true);
  });

  it("rejects an unknown code", () => {
    const { store } = lobbyOf(1);
    expect(failure(store.join({ code: "ZZZZZ", nickname: "kim" }))).toBe("LOBBY_NOT_FOUND");
  });

  it("rejects a nickname already taken, ignoring case", () => {
    const { store, code } = lobbyOf(1);
    unwrap(store.join({ code, nickname: "Kim" }));
    expect(failure(store.join({ code, nickname: "kIM" }))).toBe("NICKNAME_TAKEN");
  });

  it(`rejects the ${MAX_PLAYERS_PER_LOBBY + 1}th player`, () => {
    const { store, code } = lobbyOf(MAX_PLAYERS_PER_LOBBY);
    expect(failure(store.join({ code, nickname: "latecomer" }))).toBe("LOBBY_FULL");
  });

  it("shuts the door once the game has started", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(failure(store.join({ code, nickname: "latecomer" }))).toBe("GAME_IN_PROGRESS");
  });
});

describe("resume", () => {
  it("rebinds the seat and marks it connected again", () => {
    const { store, code, joiners } = lobbyOf(2);
    const guest = joiners[0]!;

    store.disconnect(code, guest.playerId);
    expect(store.snapshot(code)?.players[1]?.connected).toBe(false);

    const resumed = unwrap(
      store.resume({ code, playerId: guest.playerId, resumeToken: guest.resumeToken }),
    );
    expect(resumed.state.players[1]).toMatchObject({ connected: true, disconnectedAt: null });
  });

  it("rejects a wrong token", () => {
    const { store, code, joiners } = lobbyOf(2);
    const guest = joiners[0]!;
    expect(failure(store.resume({ code, playerId: guest.playerId, resumeToken: "nope" }))).toBe(
      "RESUME_REJECTED",
    );
  });

  it("rejects a token that is right but for a seat that is not there", () => {
    const { store, code, joiners } = lobbyOf(2);
    const guest = joiners[0]!;
    expect(
      failure(store.resume({ code, playerId: "ghost", resumeToken: guest.resumeToken })),
    ).toBe("RESUME_REJECTED");
  });

  it("rejects a lobby that is gone rather than reporting it separately", () => {
    const { store, joiners } = lobbyOf(2);
    const guest = joiners[0]!;
    expect(
      failure(store.resume({ code: "ZZZZZ", playerId: guest.playerId, resumeToken: guest.resumeToken })),
    ).toBe("RESUME_REJECTED");
  });

  it("does not hand the lobby back to a returning host", () => {
    const { store, code, host, joiners } = lobbyOf(2);
    const guest = joiners[0]!;

    store.disconnect(code, host.playerId);
    expect(store.snapshot(code)?.hostId).toBe(guest.playerId);

    unwrap(store.resume({ code, playerId: host.playerId, resumeToken: host.resumeToken }));
    expect(store.snapshot(code)?.hostId).toBe(guest.playerId);
  });
});

describe("setTarget", () => {
  it("lets the host change it", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.setTarget(code, host.playerId, 250));
    expect(store.snapshot(code)?.targetScore).toBe(250);
  });

  it("refuses anybody else", () => {
    const { store, code, joiners } = lobbyOf(2);
    expect(failure(store.setTarget(code, joiners[0]!.playerId, 250))).toBe("NOT_HOST");
  });

  it("refuses a value out of range", () => {
    const { store, code, host } = lobbyOf(2);
    expect(failure(store.setTarget(code, host.playerId, MAX_TARGET_SCORE + 50))).toBe(
      "INVALID_TARGET_SCORE",
    );
  });

  it("refuses once the game has started", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(failure(store.setTarget(code, host.playerId, 250))).toBe("GAME_IN_PROGRESS");
  });
});

describe("setTopics", () => {
  it("lets the host change the selection", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.setTopics(code, host.playerId, ["flags", "music"]));
    expect(store.snapshot(code)?.topics).toEqual(["flags", "music"]);
  });

  it("normalises what it is given", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.setTopics(code, host.playerId, ["music", "music", "flags"]));
    expect(store.snapshot(code)?.topics).toEqual(["flags", "music"]);
  });

  it("refuses anybody else", () => {
    const { store, code, joiners } = lobbyOf(2);
    expect(failure(store.setTopics(code, joiners[0]!.playerId, ["flags"]))).toBe("NOT_HOST");
  });

  it("refuses an empty selection, because a round needs something to be about", () => {
    const { store, code, host } = lobbyOf(2);
    expect(failure(store.setTopics(code, host.playerId, []))).toBe("INVALID_TOPICS");
    expect(store.snapshot(code)?.topics).toEqual([...ALL_TOPIC_IDS]);
  });

  it("refuses an unknown topic", () => {
    const { store, code, host } = lobbyOf(2);
    const topics = ["flags", "underwater-basket-weaving"] as unknown as TopicId[];
    expect(failure(store.setTopics(code, host.playerId, topics))).toBe("INVALID_TOPICS");
  });

  it("refuses once the game is running", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(failure(store.setTopics(code, host.playerId, ["flags"]))).toBe("GAME_IN_PROGRESS");
  });

  /**
   * The other half of `CONFIGURABLE_STATUSES`. `finished` is unreachable
   * through this API today — nothing sets it, because the round engine that
   * declares a winner does not exist yet — so this is a todo rather than a
   * test that quietly passes by never running the branch.
   */
  it.todo("allows a re-pick once a game has been won");
});

describe("start", () => {
  it("opens a countdown rather than a round, with nothing to look at yet", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));

    const state = store.snapshot(code);
    expect(state?.status).toBe("countdown");
    expect(state?.round).toMatchObject({
      number: 1,
      startsAt: NOON + COUNTDOWN_DURATION_MS,
      endsAt: null,
      content: null,
      answer: null,
    });
  });

  it("hands back what the content source needs, drawn from the lobby's own topics", () => {
    const { store, code, host, pickTopicAt } = lobbyOf(2);
    unwrap(store.setTopics(code, host.playerId, ["music", "flags"]));
    // Catalogue order, not click order: flags comes first.
    pickTopicAt(1);

    const request = unwrap(store.start(code, host.playerId));
    expect(request).toEqual({
      code,
      number: 1,
      topic: "music",
      kind: "lyrics",
      exclude: [],
      startsAt: NOON + COUNTDOWN_DURATION_MS,
    });
  });

  it("clamps a picker that returns nonsense rather than falling over", () => {
    const { store, code, host, pickTopicAt } = lobbyOf(2);
    unwrap(store.setTopics(code, host.playerId, ["flags"]));
    pickTopicAt(99);
    expect(unwrap(store.start(code, host.playerId)).topic).toBe("flags");
  });

  it("shuts the door on late joiners", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(failure(store.join({ code, nickname: "latecomer" }))).toBe("GAME_IN_PROGRESS");
  });

  it("refuses anybody but the host", () => {
    const { store, code, joiners } = lobbyOf(2);
    expect(failure(store.start(code, joiners[0]!.playerId))).toBe("NOT_HOST");
  });

  it("refuses a host on their own", () => {
    const { store, code, host } = lobbyOf(1);
    expect(failure(store.start(code, host.playerId))).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("does not count a player who has dropped", () => {
    const { store, code, host, joiners } = lobbyOf(2);
    store.disconnect(code, joiners[0]!.playerId);
    expect(failure(store.start(code, host.playerId))).toBe("NOT_ENOUGH_PLAYERS");
  });

  it("refuses a second time", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(failure(store.start(code, host.playerId))).toBe("GAME_IN_PROGRESS");
  });
});

/** A lobby of two with the countdown already running. */
function counting(down = 0) {
  const harness = lobbyOf(2);
  const request = unwrap(harness.store.start(harness.code, harness.host.playerId));
  harness.advance(down);
  return { ...harness, request };
}

describe("rounds", () => {
  it("starts the clock when the content lands, and withholds the answer", () => {
    const { store, code, request, advance } = counting();
    advance(COUNTDOWN_DURATION_MS);

    const state = store.deliverRound(code, request.number, A_PICTURE, "Bhutan", ["Kingdom of Bhutan"]);
    expect(state?.status).toBe("in_round");
    expect(state?.round?.content).toEqual(A_PICTURE);
    expect(state?.round?.endsAt).toBe(NOON + COUNTDOWN_DURATION_MS + ROUND_DURATION_MS);
    // The whole point of the projection: everybody gets this snapshot.
    expect(state?.round?.answer).toBeNull();
  });

  it("makes content that arrives early wait for the countdown", () => {
    const { store, code, request } = counting();
    const state = store.deliverRound(code, request.number, A_PICTURE, "Bhutan", []);
    expect(state?.round?.startsAt).toBe(NOON + COUNTDOWN_DURATION_MS);
  });

  it("gives a late round its full twenty seconds anyway", () => {
    const { store, code, request, advance } = counting();
    advance(11_000);
    const state = store.deliverRound(code, request.number, A_PICTURE, "Bhutan", []);
    expect(state?.round?.startsAt).toBe(NOON + 11_000);
    expect(state?.round?.endsAt).toBe(NOON + 11_000 + ROUND_DURATION_MS);
  });

  it("reveals the answer only once the round is over", () => {
    const { store, code, request } = counting(COUNTDOWN_DURATION_MS);
    store.deliverRound(code, request.number, A_PICTURE, "Bhutan", ["Kingdom of Bhutan"]);

    const state = store.revealRound(code, request.number);
    expect(state?.status).toBe("intermission");
    expect(state?.round?.answer).toBe("Bhutan");
  });

  it("puts the lobby back when the content cannot be built, ready to try again", () => {
    const { store, code, host, request } = counting();
    const state = store.abandonRound(code, request.number);
    expect(state?.status).toBe("lobby");
    expect(state?.round).toBeNull();
    expect(store.start(code, host.playerId).ok).toBe(true);
  });

  it("ignores content for a round that has already been abandoned", () => {
    const { store, code, request } = counting();
    store.abandonRound(code, request.number);
    expect(store.deliverRound(code, request.number, A_PICTURE, "Bhutan", [])).toBeNull();
    expect(store.snapshot(code)?.status).toBe("lobby");
  });

  it("ignores a transition quoting the wrong round number", () => {
    const { store, code, request } = counting(COUNTDOWN_DURATION_MS);
    expect(store.deliverRound(code, request.number + 1, A_PICTURE, "Bhutan", [])).toBeNull();
    store.deliverRound(code, request.number, A_PICTURE, "Bhutan", []);
    expect(store.revealRound(code, request.number + 1)).toBeNull();
    expect(store.snapshot(code)?.round?.answer).toBeNull();
  });

  it("refuses to abandon a round that is already being played", () => {
    const { store, code, request } = counting(COUNTDOWN_DURATION_MS);
    store.deliverRound(code, request.number, A_PICTURE, "Bhutan", []);
    expect(store.abandonRound(code, request.number)).toBeNull();
    expect(store.snapshot(code)?.status).toBe("in_round");
  });

  it("holds a dropped player's seat for the whole game, not sixty seconds", () => {
    const { store, code, request, joiners, advance } = counting(COUNTDOWN_DURATION_MS);
    store.deliverRound(code, request.number, A_PICTURE, "Bhutan", []);
    store.disconnect(code, joiners[0]!.playerId);

    advance(LOBBY_DISCONNECT_GRACE_MS * 2);
    store.sweep();

    // Greyed out, but still there and still holding their score.
    expect(store.snapshot(code)?.players).toHaveLength(2);
  });
});


/** A two-player lobby with round one live and guessing open. */
function playing() {
  const harness = counting(COUNTDOWN_DURATION_MS);
  harness.store.deliverRound(harness.code, harness.request.number, A_PICTURE, "Bhutan", [
    "Kingdom of Bhutan",
  ]);
  return harness;
}

describe("guessing", () => {
  it("scores a correct answer by how fast it arrived, and says so to the guesser", () => {
    const { store, code, host, advance } = playing();
    advance(5_000);

    const outcome = store.guess(code, host.playerId, 1, "Bhutan");
    expect(outcome.ack).toMatchObject({ ok: true, data: { correct: true, elapsedMs: 5_000 } });
    expect(unwrap(outcome.ack)).toMatchObject({ points: 16 });
  });

  it("pays the maximum on the instant and the minimum on the buzzer", () => {
    const instant = playing();
    expect(unwrap(instant.store.guess(instant.code, instant.host.playerId, 1, "Bhutan").ack))
      .toMatchObject({ points: ROUND_MAX_POINTS });

    const late = playing();
    late.advance(ROUND_DURATION_MS - 1);
    expect(unwrap(late.store.guess(late.code, late.host.playerId, 1, "Bhutan").ack))
      .toMatchObject({ points: ROUND_MIN_POINTS });
  });

  it("adds the points to the score and puts the result in the snapshot", () => {
    const { store, code, host, advance } = playing();
    advance(5_000);
    const outcome = store.guess(code, host.playerId, 1, "bhutan!");

    expect(outcome.state?.players[0]).toMatchObject({ score: 16 });
    expect(outcome.state?.round?.results).toEqual([
      { playerId: host.playerId, elapsedMs: 5_000, points: 16 },
    ]);
    // Still not the answer: the round is open and this snapshot goes to everybody.
    expect(outcome.state?.round?.answer).toBeNull();
  });

  it("accepts an alias", () => {
    const { store, code, host } = playing();
    expect(unwrap(store.guess(code, host.playerId, 1, "Kingdom of Bhutan").ack)).toMatchObject({
      correct: true,
    });
  });

  it("tells a wrong guess apart, scores nothing, and tells nobody else", () => {
    const { store, code, host } = playing();
    const outcome = store.guess(code, host.playerId, 1, "Nepal");

    expect(unwrap(outcome.ack)).toEqual({ correct: false });
    // Nothing the room can see changed, so there is nothing to broadcast.
    expect(outcome.state).toBeNull();
    expect(store.snapshot(code)?.players[0]?.score).toBe(0);
  });

  it("lets a player keep guessing until they get it", () => {
    const { store, code, host } = playing();
    store.guess(code, host.playerId, 1, "Nepal");
    store.guess(code, host.playerId, 1, "Tibet");
    expect(unwrap(store.guess(code, host.playerId, 1, "Bhutan").ack)).toMatchObject({
      correct: true,
    });
  });

  it("refuses a second correct answer from the same seat", () => {
    const { store, code, host } = playing();
    store.guess(code, host.playerId, 1, "Bhutan");
    expect(failure(store.guess(code, host.playerId, 1, "Bhutan").ack)).toBe("ALREADY_ANSWERED");
    expect(store.snapshot(code)?.players[0]?.score).toBe(ROUND_MAX_POINTS);
  });

  it.each([
    ["empty", "   "],
    ["longer than a guess", "x".repeat(200)],
  ])("refuses a guess that is %s", (_label, guess) => {
    const { store, code, host } = playing();
    expect(failure(store.guess(code, host.playerId, 1, guess).ack)).toBe("INVALID_GUESS");
  });

  it("refuses a guess quoting a round that is not the one being played", () => {
    const { store, code, host } = playing();
    expect(failure(store.guess(code, host.playerId, 2, "Bhutan").ack)).toBe("ROUND_NOT_OPEN");
  });

  it("refuses a guess during the countdown, before there is anything to look at", () => {
    const { store, code, host } = counting();
    expect(failure(store.guess(code, host.playerId, 1, "Bhutan").ack)).toBe("ROUND_NOT_OPEN");
  });

  it("refuses a guess that arrives on or after the deadline", () => {
    const { store, code, host, advance } = playing();
    advance(ROUND_DURATION_MS);
    expect(failure(store.guess(code, host.playerId, 1, "Bhutan").ack)).toBe("ROUND_NOT_OPEN");
  });

  it("refuses somebody who is not in the lobby", () => {
    const { store, code } = playing();
    expect(failure(store.guess(code, "player-nobody", 1, "Bhutan").ack)).toBe("LOBBY_NOT_FOUND");
  });

  it("says the round is complete only once everybody present has it", () => {
    const { store, code, host, joiners } = playing();
    expect(store.guess(code, host.playerId, 1, "Bhutan").complete).toBe(false);
    expect(store.guess(code, joiners[0]!.playerId, 1, "Bhutan").complete).toBe(true);
  });

  it("does not wait on a player who has dropped", () => {
    const { store, code, host, joiners } = playing();
    store.disconnect(code, joiners[0]!.playerId);
    expect(store.guess(code, host.playerId, 1, "Bhutan").complete).toBe(true);
  });
});

describe("the round loop", () => {
  /** A lobby whose round one has been played, revealed, and is now in its gap. */
  function inIntermission(score: number) {
    const harness = playing();
    if (score > 0) {
      // Answering on the instant is worth the maximum, so this is the shortest
      // way to put a chosen number of points on the host's row.
      harness.store.guess(harness.code, harness.host.playerId, 1, "Bhutan");
    }
    harness.advance(ROUND_DURATION_MS);
    harness.store.revealRound(harness.code, 1);
    return harness;
  }

  it("stamps when the next countdown opens", () => {
    const { store, code } = inIntermission(0);
    const state = store.snapshot(code);
    expect(state?.status).toBe("intermission");
    expect(state?.round?.intermissionEndsAt).toBe(
      NOON + COUNTDOWN_DURATION_MS + ROUND_DURATION_MS + INTERMISSION_DURATION_MS,
    );
  });

  it("opens the next round's countdown when nobody has won yet", () => {
    const { store, code, advance } = inIntermission(ROUND_MAX_POINTS);
    advance(INTERMISSION_DURATION_MS);

    const advanced = store.advance(code, 1);
    expect(advanced?.kind).toBe("next");
    expect(advanced?.state.status).toBe("countdown");
    expect(advanced?.state.round).toMatchObject({
      number: 2,
      content: null,
      answer: null,
      results: [],
      endsAt: null,
      intermissionEndsAt: null,
    });
    // A fresh request, for a round the source has not been asked about yet.
    expect(advanced?.kind === "next" && advanced.request).toMatchObject({
      code,
      number: 2,
      // The answer just used, so the source does not serve Bhutan twice.
      exclude: ["Bhutan"],
    });
  });

  it("keeps the scores across the round boundary", () => {
    const { store, code, host, advance } = inIntermission(ROUND_MAX_POINTS);
    advance(INTERMISSION_DURATION_MS);
    store.advance(code, 1);

    expect(store.snapshot(code)?.players[0]).toMatchObject({
      id: host.playerId,
      score: ROUND_MAX_POINTS,
    });
  });

  it("stops on a winner rather than opening another round", () => {
    const harness = lobbyOf(2);
    const { store, code, host } = harness;
    unwrap(store.setTarget(code, host.playerId, MIN_TARGET_SCORE));

    // MIN_TARGET_SCORE at ROUND_MAX_POINTS a round, answered instantly.
    const rounds = Math.ceil(MIN_TARGET_SCORE / ROUND_MAX_POINTS);
    let request = unwrap(store.start(code, host.playerId));

    for (let round = 1; round <= rounds; round += 1) {
      harness.advance(COUNTDOWN_DURATION_MS);
      store.deliverRound(code, request.number, A_PICTURE, `Answer ${round}`, []);
      store.guess(code, host.playerId, request.number, `Answer ${round}`);
      harness.advance(ROUND_DURATION_MS);
      store.revealRound(code, request.number);
      harness.advance(INTERMISSION_DURATION_MS);

      const advanced = store.advance(code, request.number);
      if (round < rounds) {
        expect(advanced?.kind).toBe("next");
        if (advanced?.kind !== "next") throw new Error("expected another round");
        request = advanced.request;
        continue;
      }
      expect(advanced?.kind).toBe("finished");
    }

    const state = store.snapshot(code);
    expect(state?.status).toBe("finished");
    expect(state?.players[0]?.score).toBeGreaterThanOrEqual(MIN_TARGET_SCORE);
  });

  it("ignores an advance quoting the wrong round, or one from the wrong phase", () => {
    const { store, code } = inIntermission(0);
    expect(store.advance(code, 2)).toBeNull();

    const midRound = playing();
    expect(midRound.store.advance(midRound.code, 1)).toBeNull();
  });
});

describe("reopening a failed round", () => {
  it("gives the same round number a fresh countdown on a different topic", () => {
    const { store, code, request, advance, pickTopicAt } = counting();
    advance(5_000);
    // Index zero would re-draw the failed topic from the full list; the
    // avoided list starts one further over.
    pickTopicAt(0);

    const reopened = store.reopenRound(code, request.number, request.topic);
    expect(reopened?.request.number).toBe(request.number);
    expect(reopened?.request.topic).not.toBe(request.topic);
    expect(reopened?.request.startsAt).toBe(NOON + 5_000 + COUNTDOWN_DURATION_MS);
    expect(reopened?.state.status).toBe("countdown");
    expect(reopened?.state.round).toMatchObject({
      number: request.number,
      topic: reopened?.request.topic,
      content: null,
    });
  });

  it("keeps the topic when it is the only one the lobby plays", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.setTopics(code, host.playerId, ["flags"]));
    unwrap(store.start(code, host.playerId));

    expect(store.reopenRound(code, 1, "flags")?.request.topic).toBe("flags");
  });

  it("carries the game's used answers into the retried request", () => {
    const { store, code, host, advance } = playing();
    store.guess(code, host.playerId, 1, "Bhutan");
    advance(ROUND_DURATION_MS);
    store.revealRound(code, 1);
    advance(INTERMISSION_DURATION_MS);
    const next = store.advance(code, 1);
    if (next?.kind !== "next") throw new Error("expected another round");

    const reopened = store.reopenRound(code, 2, next.request.topic);
    expect(reopened?.request.exclude).toEqual(["Bhutan"]);
  });

  it("refuses a round that is not on its countdown", () => {
    const midRound = playing();
    expect(midRound.store.reopenRound(midRound.code, 1, "flags")).toBeNull();

    const wrongNumber = counting();
    expect(wrongNumber.store.reopenRound(wrongNumber.code, 2, "flags")).toBeNull();
  });
});

describe("prefetching the next round", () => {
  it("describes the round after the one on screen, current answer excluded", () => {
    const { store, code, pickTopicAt } = playing();
    pickTopicAt(1);

    const request = store.prepareNext(code, 1);
    expect(request).toMatchObject({
      code,
      number: 2,
      topic: ALL_TOPIC_IDS[1],
      // Bhutan is not in usedAnswers until the reveal, but serving it again
      // next round would still be serving it twice.
      exclude: ["Bhutan"],
    });
  });

  it("keeps the answers of earlier rounds on the exclusion list", () => {
    const { store, code, host, advance } = playing();
    store.guess(code, host.playerId, 1, "Bhutan");
    advance(ROUND_DURATION_MS);
    store.revealRound(code, 1);
    advance(INTERMISSION_DURATION_MS);
    const next = store.advance(code, 1);
    if (next?.kind !== "next") throw new Error("expected another round");
    advance(COUNTDOWN_DURATION_MS);
    store.deliverRound(code, 2, A_PICTURE, "Japan", []);

    expect(store.prepareNext(code, 2)?.exclude).toEqual(["Bhutan", "Japan"]);
  });

  it("hands the same topic to advance that it handed to the prefetch", () => {
    const { store, code, host, advance, pickTopicAt } = playing();
    pickTopicAt(2);
    const prepared = store.prepareNext(code, 1);
    // If advance drew afresh it would land here instead, and the content
    // prefetched for `prepared.topic` would be about the wrong thing.
    pickTopicAt(0);

    store.guess(code, host.playerId, 1, "Bhutan");
    advance(ROUND_DURATION_MS);
    store.revealRound(code, 1);
    advance(INTERMISSION_DURATION_MS);

    const advanced = store.advance(code, 1);
    if (advanced?.kind !== "next") throw new Error("expected another round");
    expect(advanced.request.topic).toBe(prepared?.topic);
    expect(advanced.request.topic).toBe(ALL_TOPIC_IDS[2]);
  });

  it("refuses a round that is not the one being played", () => {
    const midRound = playing();
    expect(midRound.store.prepareNext(midRound.code, 2)).toBeNull();

    // During the countdown there is no answer to exclude yet, and after the
    // reveal the next round is about to be opened for real.
    const stillCounting = counting();
    expect(stillCounting.store.prepareNext(stillCounting.code, 1)).toBeNull();
  });
});

describe("leave", () => {
  it("frees the seat immediately", () => {
    const { store, code, joiners } = lobbyOf(2);
    const state = store.leave(code, joiners[0]!.playerId);
    expect(state?.players).toHaveLength(1);
  });

  it("promotes the longest-present player when the host goes", () => {
    const { store, code, host, joiners } = lobbyOf(3);
    const state = store.leave(code, host.playerId);
    expect(state?.hostId).toBe(joiners[0]!.playerId);
  });

  it("deletes the lobby when the last player goes", () => {
    const { store, code, host } = lobbyOf(1);
    expect(store.leave(code, host.playerId)).toBeNull();
    expect(store.size()).toBe(0);
  });

  it("ignores a player who is not there", () => {
    const { store, code } = lobbyOf(2);
    expect(store.leave(code, "ghost")).toBeNull();
    expect(store.snapshot(code)?.players).toHaveLength(2);
  });
});

describe("disconnect", () => {
  it("keeps the seat and marks it dropped", () => {
    const { store, code, joiners } = lobbyOf(2);
    const state = store.disconnect(code, joiners[0]!.playerId);
    expect(state?.players[1]).toMatchObject({ connected: false, disconnectedAt: NOON });
  });

  it("promotes the longest-present player who is actually there", () => {
    const { store, code, host, joiners } = lobbyOf(3);
    store.disconnect(code, joiners[0]!.playerId);

    const state = store.disconnect(code, host.playerId);
    expect(state?.hostId).toBe(joiners[1]!.playerId);
  });

  it("is idempotent", () => {
    const { store, code, joiners } = lobbyOf(2);
    store.disconnect(code, joiners[0]!.playerId);
    expect(store.disconnect(code, joiners[0]!.playerId)).toBeNull();
  });
});

describe("sweep", () => {
  it("holds a pre-game seat right up to the grace period", () => {
    const { store, code, joiners, advance } = lobbyOf(2);
    store.disconnect(code, joiners[0]!.playerId);

    advance(LOBBY_DISCONNECT_GRACE_MS - 1);
    expect(store.sweep().changed).toHaveLength(0);
    expect(store.snapshot(code)?.players).toHaveLength(2);

    advance(1);
    const { changed } = store.sweep();
    expect(changed[0]?.players).toHaveLength(1);
  });

  it("holds an in-game seat indefinitely, because the score is worth more", () => {
    const { store, code, host, joiners, advance } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    store.disconnect(code, joiners[0]!.playerId);

    advance(LOBBY_DISCONNECT_GRACE_MS * 30);
    store.sweep();

    expect(store.snapshot(code)?.players).toHaveLength(2);
  });

  it("hands the lobby on when the reaped seat was the host", () => {
    const { store, code, host, joiners, advance } = lobbyOf(2);
    store.disconnect(code, host.playerId);

    advance(LOBBY_DISCONNECT_GRACE_MS);
    const { changed } = store.sweep();

    expect(changed[0]?.hostId).toBe(joiners[0]!.playerId);
    expect(changed[0]?.players).toHaveLength(1);
  });

  it("closes a lobby whose pre-game seats all expired", () => {
    const { store, code, host, joiners, advance } = lobbyOf(2);
    store.disconnect(code, host.playerId);
    store.disconnect(code, joiners[0]!.playerId);

    advance(LOBBY_DISCONNECT_GRACE_MS);
    expect(store.sweep().closed).toEqual([{ code, reason: "empty" }]);
    expect(store.size()).toBe(0);
  });

  it("closes an in-game lobby nobody has come back to", () => {
    const { store, code, host, joiners, advance } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    store.disconnect(code, host.playerId);

    advance(60_000);
    store.disconnect(code, joiners[0]!.playerId);

    // Five minutes after the first drop, but only four after the last.
    advance(EMPTY_LOBBY_TTL_MS - 60_000);
    expect(store.sweep().closed).toHaveLength(0);

    advance(60_000);
    expect(store.sweep().closed).toEqual([{ code, reason: "empty" }]);
  });

  it("closes a lobby people are still sitting in but nobody is playing", () => {
    const { store, code, host, advance } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));

    advance(IDLE_LOBBY_TTL_MS - 1);
    expect(store.sweep().closed).toHaveLength(0);

    advance(1);
    expect(store.sweep().closed).toEqual([{ code, reason: "idle" }]);
  });

  it("leaves a healthy lobby alone", () => {
    const { store, advance } = lobbyOf(3);
    advance(IDLE_LOBBY_TTL_MS - 1);
    expect(store.sweep()).toEqual({ changed: [], closed: [] });
  });
});

describe("the snapshot", () => {
  it("carries no resume token and no join time", () => {
    const { store, code, host } = lobbyOf(2);
    const serialized = JSON.stringify(store.snapshot(code));

    expect(serialized).not.toContain(host.resumeToken);
    expect(serialized).not.toContain("resumeToken");
    expect(serialized).not.toContain("joinedAt");
  });

  it("is null for a lobby that does not exist", () => {
    const { store } = lobbyOf(1);
    expect(store.snapshot("ZZZZZ")).toBeNull();
  });
});
