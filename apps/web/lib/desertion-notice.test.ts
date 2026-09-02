import { describe, expect, it } from "vitest"
import { DESERTED_GAME_GRACE_MS, type LobbyState } from "@guessly/protocol"

import { desertionNotice } from "./desertion-notice"

const NOON = 1_700_000_000_000

/** A snapshot with only the fields this decision reads varied. */
function snapshot(overrides: Partial<LobbyState> = {}): LobbyState {
  return {
    code: "WBVA4",
    status: "in_round",
    targetScore: 100,
    hostId: "p1",
    topics: ["flags"],
    language: "en",
    players: [
      { id: "p1", nickname: "JHan", score: 15, connected: true, disconnectedAt: null },
      { id: "p2", nickname: "Martin", score: 0, connected: true, disconnectedAt: null },
    ],
    round: null,
    desertedEndsAt: null,
    serverNow: NOON,
    ...overrides,
  }
}

/** Extra seats, numbered on from the two every snapshot starts with. */
function more(...nicknames: string[]): LobbyState["players"] {
  return nicknames.map((nickname, index) => ({
    id: `p${index + 3}`,
    nickname,
    score: 0,
    connected: true,
    disconnectedAt: null,
  }))
}

/** The same lobby, with `who` away and the grace counting down from `serverNow`. */
function counting(who: string[], overrides: Partial<LobbyState> = {}): LobbyState {
  const base = snapshot(overrides)
  return {
    ...base,
    desertedEndsAt: base.serverNow + DESERTED_GAME_GRACE_MS,
    players: base.players.map((player) =>
      who.includes(player.id)
        ? { ...player, connected: false, disconnectedAt: base.serverNow }
        : player
    ),
  }
}

describe("the grace starting", () => {
  it("names the player everybody is waiting on, and how long for", () => {
    expect(desertionNotice(snapshot(), counting(["p2"]))).toEqual({
      kind: "warn",
      away: "Martin",
      seconds: DESERTED_GAME_GRACE_MS / 1000,
      ms: DESERTED_GAME_GRACE_MS,
    })
  })

  it("counts what is left rather than the whole grace, for a tab that just reloaded", () => {
    // Eight seconds in: the deadline is where it was, the clock has moved on.
    const midway = counting(["p2"])
    const notice = desertionNotice(null, { ...midway, serverNow: midway.serverNow + 8_000 })

    expect(notice).toMatchObject({ kind: "warn", seconds: 22 })
  })

  it("says it once, not again for the next player to drop", () => {
    const first = counting(["p2"])
    const second = counting(["p1", "p2"])
    expect(desertionNotice(first, second)).toBeNull()
  })

  it("reads a lobby this tab has never seen as a fresh warning", () => {
    // A different code is a different game; its deadline is news here.
    const elsewhere = snapshot({ code: "QQQQQ", desertedEndsAt: NOON + 1 })
    expect(desertionNotice(elsewhere, counting(["p2"]))).toMatchObject({ kind: "warn" })
  })

  it("names two of them, and counts more than two", () => {
    const crowd = { players: [...snapshot().players, ...more("Kim", "Sam", "Ada")] }
    expect(desertionNotice(snapshot(crowd), counting(["p2", "p3"], crowd))).toMatchObject({
      away: "Martin and Kim",
    })
    expect(
      desertionNotice(snapshot(crowd), counting(["p2", "p3", "p4", "p5"], crowd)),
    ).toMatchObject({ away: "4 players" })
  })
})

describe("the grace ending", () => {
  it("is a reprieve when the game is still being played", () => {
    expect(desertionNotice(counting(["p2"]), snapshot())).toEqual({ kind: "recovered" })
  })

  it("is an explanation when nobody came back", () => {
    const over = snapshot({ status: "finished" })
    expect(desertionNotice(counting(["p2"]), over)).toEqual({ kind: "calledOff" })
  })

  it("blames nothing when the last player standing won it instead", () => {
    // Finished during the grace, but on the target rather than the clock.
    const won = snapshot({
      status: "finished",
      players: [
        { id: "p1", nickname: "JHan", score: 100, connected: true, disconnectedAt: null },
        { id: "p2", nickname: "Martin", score: 0, connected: false, disconnectedAt: NOON },
      ],
    })
    expect(desertionNotice(counting(["p2"]), won)).toBeNull()
  })
})

describe("a lobby nothing is happening to", () => {
  it("says nothing", () => {
    expect(desertionNotice(snapshot(), snapshot())).toBeNull()
    expect(desertionNotice(null, snapshot())).toBeNull()
  })
})
