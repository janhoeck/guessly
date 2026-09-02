import { afterEach, describe, expect, it } from "vitest";
import {
  ALL_TOPIC_IDS,
  DEFAULT_LANGUAGE,
  DESERTED_GAME_GRACE_MS,
  type LobbyState,
} from "@guessly/protocol";
import type { RoundContentSource } from "../content/source.js";
import { createLobbyStore, type LobbyStore } from "../lobby/store.js";
import { createRoundRunner, type RoundRunner } from "./rounds.js";

/**
 * The runner's own clocks, which the socket tests cannot wait out: they drive a
 * real Socket.IO server and cannot sit through a grace measured in seconds.
 *
 * Here the store's clock is wound back instead, exactly far enough that the
 * thirty-second deadline it stamps lands twenty milliseconds from now. Nothing
 * about the rule is faked — the store stamps the same deadline it always does
 * and the runner waits for it the same way — the clock it is stamped against
 * has just been moved.
 */

const GRACE_MS = 20;

/** Wound back, so `now + DESERTED_GAME_GRACE_MS` is `Date.now() + GRACE_MS`. */
const woundBack = (): number => Date.now() - DESERTED_GAME_GRACE_MS + GRACE_MS;

const started: { runner: RoundRunner; code: string }[] = [];

afterEach(() => {
  for (const { runner, code } of started) runner.cancel(code);
  started.length = 0;
});

/** A two-player game sitting on round one, waiting on content that never comes. */
function playing() {
  const store: LobbyStore = createLobbyStore({ now: woundBack });
  const seen: LobbyState[] = [];

  // A source that never answers keeps the game on its countdown, which is where
  // it is most obviously still running and least able to notice it has nobody
  // in it.
  const source: RoundContentSource = { build: () => new Promise(() => {}) };

  const runner = createRoundRunner({
    store,
    source,
    broadcast: (state) => {
      if (state) seen.push(state);
    },
    onFailed: () => {},
  });

  const host = unwrap(
    store.create({
      nickname: "host",
      targetScore: 100,
      topics: [...ALL_TOPIC_IDS],
      language: DEFAULT_LANGUAGE,
    }),
  );
  const guest = unwrap(store.join({ code: host.code, nickname: "kim" }));
  started.push({ runner, code: host.code });

  runner.begin(unwrap(store.start(host.code, host.playerId)));
  return { store, runner, seen, code: host.code, host, guest };
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; message: string }): T {
  if (!result.ok) throw new Error(`expected ok: ${result.message}`);
  return result.data;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Comfortably past a deadline stamped now. */
const waitOutTheGrace = (): Promise<void> => wait(GRACE_MS * 3);

describe("a game left without enough players", () => {
  it("is called off when the deadline the store stamped arrives", async () => {
    const { store, runner, seen, code, guest } = playing();
    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);

    await waitOutTheGrace();

    expect(store.snapshot(code)?.status).toBe("finished");
    expect(seen.at(-1)).toMatchObject({ status: "finished", round: null, desertedEndsAt: null });
  });

  it("is left alone while the deadline is still ahead", async () => {
    const { store, runner, code, guest } = playing();
    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);

    await wait(GRACE_MS / 4);
    expect(store.snapshot(code)?.status).toBe("countdown");
  });

  it("plays on when somebody comes back before the deadline", async () => {
    const { store, runner, seen, code, guest } = playing();
    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);

    store.resume({ code, playerId: guest.playerId, resumeToken: guest.resumeToken });
    runner.rosterChanged(code);

    await waitOutTheGrace();

    expect(store.snapshot(code)?.status).toBe("countdown");
    expect(seen.some((state) => state.status === "finished")).toBe(false);
  });

  it("starts the wait over when the room recovers and empties again", async () => {
    const { store, runner, code, guest } = playing();

    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);
    store.resume({ code, playerId: guest.playerId, resumeToken: guest.resumeToken });
    runner.rosterChanged(code);

    await wait(GRACE_MS * 0.75);
    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);

    // Past where the first deadline was, well short of the second.
    await wait(GRACE_MS / 2);
    expect(store.snapshot(code)?.status).toBe("countdown");

    await waitOutTheGrace();
    expect(store.snapshot(code)?.status).toBe("finished");
  });

  it("does nothing for a lobby with no game in flight", async () => {
    const { store, runner, code, guest } = playing();
    runner.cancel(code);
    store.disconnect(code, guest.playerId);
    runner.rosterChanged(code);

    await waitOutTheGrace();
    expect(store.snapshot(code)?.status).toBe("countdown");
  });
});
