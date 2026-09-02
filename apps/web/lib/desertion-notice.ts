import type { LobbyState } from "@guessly/protocol"

/**
 * What to tell the room about a game that has run out of players, given the two
 * snapshots either side of a change.
 *
 * Pure, and separate from the toast that shows it, because the decision has four
 * outcomes and only one of them is obvious. The deadline rides in the snapshot,
 * so this notices a *transition* rather than running a clock: null → a number is
 * the grace starting, a number → null is it ending — and which way it ended is
 * the difference between a reprieve and an explanation the player is owed.
 */
export type DesertionNotice =
  /** The grace has started. `seconds` is what is left of it, `ms` the same in full. */
  | { kind: "warn"; away: string; seconds: number; ms: number }
  /** Somebody came back in time. */
  | { kind: "recovered" }
  /** Nobody did, and the game was called off. */
  | { kind: "calledOff" }
  /** Nothing to say, including the case where the warning is already up. */
  | null

/** "Martin", "Martin and Kim", "3 players". */
function nameThem(away: readonly LobbyState["players"][number][]): string {
  if (away.length === 1) return away[0]!.nickname
  if (away.length === 2) return `${away[0]!.nickname} and ${away[1]!.nickname}`
  return `${away.length} players`
}

export function desertionNotice(
  before: LobbyState | null,
  after: LobbyState
): DesertionNotice {
  // A different lobby is a different game, and nothing carries across.
  const was = before !== null && before.code === after.code ? before.desertedEndsAt : null

  if (after.desertedEndsAt !== null) {
    // Already said. A later snapshot inside the grace is somebody else
    // dropping, which moves no deadline and does not need saying twice.
    if (was !== null) return null

    // Read off the deadline rather than the grace constant, so a tab that
    // reloads eight seconds in says twenty-two and not thirty. Both numbers are
    // the server's; neither is this file's to invent.
    const ms = Math.max(0, after.desertedEndsAt - after.serverNow)
    return {
      kind: "warn",
      away: nameThem(after.players.filter((player) => !player.connected)),
      seconds: Math.max(1, Math.round(ms / 1000)),
      ms,
    }
  }

  if (was === null) return null
  if (after.status !== "finished") return { kind: "recovered" }

  // The game ended during the grace, and reaching the target beats the clock to
  // it. Blaming the drop for a game somebody won would be a lie about the one
  // thing the results page exists to report.
  const won = after.players.some((player) => player.score >= after.targetScore)
  return won ? null : { kind: "calledOff" }
}
