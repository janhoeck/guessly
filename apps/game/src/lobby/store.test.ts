import { describe, expect, it } from "vitest";
import {
  EMPTY_LOBBY_TTL_MS,
  IDLE_LOBBY_TTL_MS,
  LOBBY_DISCONNECT_GRACE_MS,
  MAX_PLAYERS_PER_LOBBY,
  ALL_TOPIC_IDS,
  MAX_TARGET_SCORE,
  MIN_TARGET_SCORE,
  type Ack,
  type CreateLobbyPayload,
  type ErrorCode,
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

  const store = createLobbyStore({
    now: () => now,
    generateCode: () => codes.shift() ?? `CODE${(codeCount += 1)}`,
    generatePlayerId: () => `player-${(idCount += 1)}`,
    generateToken: () => `token-${(tokenCount += 1)}`,
  });

  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
    queueCodes: (...more: string[]) => codes.push(...more),
  };
}

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
  it("moves the lobby into a round", () => {
    const { store, code, host } = lobbyOf(2);
    unwrap(store.start(code, host.playerId));
    expect(store.snapshot(code)?.status).toBe("in_round");
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
