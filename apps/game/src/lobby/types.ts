import type { LobbyState, LobbyStatus, Player } from "@guessly/protocol";

/**
 * A seat as the server holds it. The two extra fields are the reason this type
 * exists separately from the protocol's `Player`: neither may ever reach the
 * wire, and the projection below is what guarantees that.
 */
export interface PlayerRecord extends Player {
  /** When this seat was taken. Ties with Map insertion order; see promoteHost. */
  joinedAt: number;
  /** The seat's secret. Sent once, to its owner, and never broadcast. */
  resumeToken: string;
}

export interface LobbyRecord {
  code: string;
  status: LobbyStatus;
  targetScore: number;
  hostId: string;
  /** Insertion ordered, and never re-inserted, so this is join order. */
  players: Map<string, PlayerRecord>;
  createdAt: number;
  lastActivityAt: number;
}

/**
 * The only path from a LobbyRecord to something broadcastable. Each player is
 * rebuilt field by field rather than spread, so adding a secret to
 * `PlayerRecord` cannot silently leak it into every client's snapshot.
 */
export function toLobbyState(lobby: LobbyRecord): LobbyState {
  return {
    code: lobby.code,
    status: lobby.status,
    targetScore: lobby.targetScore,
    hostId: lobby.hostId,
    players: [...lobby.players.values()].map((player) => ({
      id: player.id,
      nickname: player.nickname,
      score: player.score,
      connected: player.connected,
      disconnectedAt: player.disconnectedAt,
    })),
  };
}
