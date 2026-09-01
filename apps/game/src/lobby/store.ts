import {
  EMPTY_LOBBY_TTL_MS,
  IDLE_LOBBY_TTL_MS,
  LOBBY_DISCONNECT_GRACE_MS,
  MAX_PLAYERS_PER_LOBBY,
  MAX_TARGET_SCORE,
  MIN_PLAYERS_TO_START,
  MIN_TARGET_SCORE,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  err,
  ok,
  type Ack,
  type AckFailure,
  type CreateLobbyPayload,
  type CreateLobbyResult,
  type JoinLobbyPayload,
  type JoinLobbyResult,
  type LobbyClosedReason,
  type LobbyState,
  type ResumeLobbyPayload,
  type ResumeLobbyResult,
} from "@guessly/protocol";
import { generateCode, generatePlayerId, generateToken, tokensMatch } from "./codes.js";
import { toLobbyState, type LobbyRecord, type PlayerRecord } from "./types.js";

/**
 * Everything nondeterministic, injected. The clock is the obvious one, but
 * codes and tokens are the other two — collision retry is untestable without
 * being able to make the generator collide.
 */
export interface LobbyStoreDeps {
  now: () => number;
  generateCode: () => string;
  generatePlayerId: () => string;
  generateToken: () => string;
}

/** What one sweep tick changed. The caller turns this into socket traffic. */
export interface SweepResult {
  /** Lobbies that survived but look different now. */
  changed: LobbyState[];
  /** Lobbies that are gone. */
  closed: { code: string; reason: LobbyClosedReason }[];
}

export interface LobbyStore {
  create(payload: CreateLobbyPayload): Ack<CreateLobbyResult>;
  join(payload: JoinLobbyPayload): Ack<JoinLobbyResult>;
  resume(payload: ResumeLobbyPayload): Ack<ResumeLobbyResult>;
  setTarget(code: string, playerId: string, targetScore: number): Ack<Record<string, never>>;
  start(code: string, playerId: string): Ack<Record<string, never>>;
  /** Intentional exit. Returns the snapshot to broadcast, or null if there is nobody left to tell. */
  leave(code: string, playerId: string): LobbyState | null;
  /** Involuntary drop. The seat is kept; how long depends on the phase. */
  disconnect(code: string, playerId: string): LobbyState | null;
  sweep(): SweepResult;
  snapshot(code: string): LobbyState | null;
  /** Operational visibility; no rule depends on it. */
  size(): number;
}

/** How many collisions to tolerate before giving up on a free code. */
const MAX_CODE_ATTEMPTS = 100;

/** Tabs, newlines and other C0/C1 controls would let a nickname wreck a scoreboard. */
const CONTROL_CHARACTERS = /\p{Cc}/u;

const normalizeCode = (code: string): string => code.trim().toUpperCase();

/** Counted in code points, so an emoji costs one character and not two. */
const nicknameLength = (nickname: string): number => [...nickname].length;

export function createLobbyStore(overrides: Partial<LobbyStoreDeps> = {}): LobbyStore {
  const deps: LobbyStoreDeps = {
    now: Date.now,
    generateCode,
    generatePlayerId,
    generateToken,
    ...overrides,
  };

  const lobbies = new Map<string, LobbyRecord>();

  const checkNickname = (nickname: string): AckFailure | null => {
    const length = nicknameLength(nickname);
    if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
      return {
        ok: false,
        error: "INVALID_NICKNAME",
        message: `Nicknames are ${NICKNAME_MIN_LENGTH}–${NICKNAME_MAX_LENGTH} characters.`,
      };
    }
    if (CONTROL_CHARACTERS.test(nickname)) {
      return { ok: false, error: "INVALID_NICKNAME", message: "Nicknames cannot contain control characters." };
    }
    return null;
  };

  const checkTargetScore = (targetScore: number): AckFailure | null => {
    if (!Number.isInteger(targetScore) || targetScore < MIN_TARGET_SCORE || targetScore > MAX_TARGET_SCORE) {
      return {
        ok: false,
        error: "INVALID_TARGET_SCORE",
        message: `The target score is a whole number from ${MIN_TARGET_SCORE} to ${MAX_TARGET_SCORE}.`,
      };
    }
    return null;
  };

  const isNicknameTaken = (lobby: LobbyRecord, nickname: string): boolean => {
    const wanted = nickname.toLowerCase();
    for (const player of lobby.players.values()) {
      if (player.nickname.toLowerCase() === wanted) return true;
    }
    return false;
  };

  const allocateCode = (): string | null => {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
      const code = deps.generateCode();
      if (!lobbies.has(code)) return code;
    }
    return null;
  };

  const makePlayer = (nickname: string, now: number): PlayerRecord => ({
    id: deps.generatePlayerId(),
    nickname,
    score: 0,
    connected: true,
    disconnectedAt: null,
    joinedAt: now,
    resumeToken: deps.generateToken(),
  });

  /**
   * Map order is join order, so the first entry is the longest-present player.
   * A connected one is preferred: handing the lobby to a seat that is not there
   * would freeze everybody, which is the exact thing this rule exists to stop.
   */
  const promoteHost = (lobby: LobbyRecord): void => {
    let fallback: string | null = null;
    for (const player of lobby.players.values()) {
      fallback ??= player.id;
      if (player.connected) {
        lobby.hostId = player.id;
        return;
      }
    }
    if (fallback !== null) lobby.hostId = fallback;
  };

  const requireHost = (
    code: string,
    playerId: string,
  ): { lobby: LobbyRecord } | AckFailure => {
    const lobby = lobbies.get(normalizeCode(code));
    if (!lobby) return { ok: false, error: "LOBBY_NOT_FOUND", message: "That lobby no longer exists." };
    if (lobby.hostId !== playerId) {
      return { ok: false, error: "NOT_HOST", message: "Only the host can do that." };
    }
    if (lobby.status !== "lobby") {
      return { ok: false, error: "GAME_IN_PROGRESS", message: "The game has already started." };
    }
    return { lobby };
  };

  return {
    create({ nickname, targetScore }) {
      const name = nickname.trim();
      const nameError = checkNickname(name);
      if (nameError) return nameError;
      const targetError = checkTargetScore(targetScore);
      if (targetError) return targetError;

      const code = allocateCode();
      if (code === null) {
        return err("SERVER_ERROR", "Could not allocate a lobby code. Please try again.");
      }

      const now = deps.now();
      const host = makePlayer(name, now);
      const lobby: LobbyRecord = {
        code,
        status: "lobby",
        targetScore,
        hostId: host.id,
        players: new Map([[host.id, host]]),
        createdAt: now,
        lastActivityAt: now,
      };
      lobbies.set(code, lobby);

      return ok({
        code,
        playerId: host.id,
        resumeToken: host.resumeToken,
        state: toLobbyState(lobby),
      });
    },

    join({ code, nickname }) {
      const lobby = lobbies.get(normalizeCode(code));
      if (!lobby) return err("LOBBY_NOT_FOUND", "No lobby with that code.");
      if (lobby.status !== "lobby") {
        // Late joiners cannot win from far behind, so the door shuts at kick-off.
        return err("GAME_IN_PROGRESS", "That game has already started.");
      }

      const name = nickname.trim();
      const nameError = checkNickname(name);
      if (nameError) return nameError;

      if (lobby.players.size >= MAX_PLAYERS_PER_LOBBY) {
        return err("LOBBY_FULL", `That lobby is full at ${MAX_PLAYERS_PER_LOBBY} players.`);
      }
      if (isNicknameTaken(lobby, name)) {
        return err("NICKNAME_TAKEN", `"${name}" is taken in that lobby.`);
      }

      const now = deps.now();
      const player = makePlayer(name, now);
      lobby.players.set(player.id, player);
      lobby.lastActivityAt = now;

      return ok({ playerId: player.id, resumeToken: player.resumeToken, state: toLobbyState(lobby) });
    },

    resume({ code, playerId, resumeToken }) {
      // One code for every failure: whichever it was, the client's stored seat
      // is worthless and it should go back to the join screen.
      const rejected = err<ResumeLobbyResult>("RESUME_REJECTED", "That seat could not be reclaimed.");

      const lobby = lobbies.get(normalizeCode(code));
      if (!lobby) return rejected;
      const player = lobby.players.get(playerId);
      if (!player) return rejected;
      if (!tokensMatch(player.resumeToken, resumeToken)) return rejected;

      const now = deps.now();
      player.connected = true;
      player.disconnectedAt = null;
      lobby.lastActivityAt = now;
      // hostId is deliberately untouched: a returning host does not take it back.

      return ok({ state: toLobbyState(lobby) });
    },

    setTarget(code, playerId, targetScore) {
      const host = requireHost(code, playerId);
      if ("ok" in host) return host;
      const targetError = checkTargetScore(targetScore);
      if (targetError) return targetError;

      host.lobby.targetScore = targetScore;
      host.lobby.lastActivityAt = deps.now();
      return ok({});
    },

    start(code, playerId) {
      const host = requireHost(code, playerId);
      if ("ok" in host) return host;

      let connected = 0;
      for (const player of host.lobby.players.values()) {
        if (player.connected) connected += 1;
      }
      if (connected < MIN_PLAYERS_TO_START) {
        return err("NOT_ENOUGH_PLAYERS", `You need ${MIN_PLAYERS_TO_START} players to start.`);
      }

      // The seam the round engine plugs into. Until it exists the lobby simply
      // moves into `in_round` with no round attached, which is what closes the
      // door on late joiners and freezes the target score.
      host.lobby.status = "in_round";
      host.lobby.lastActivityAt = deps.now();
      return ok({});
    },

    leave(code, playerId) {
      const key = normalizeCode(code);
      const lobby = lobbies.get(key);
      if (!lobby) return null;
      if (!lobby.players.delete(playerId)) return null;

      // Nobody left to hold a seat for, so the sweep has nothing to wait for.
      if (lobby.players.size === 0) {
        lobbies.delete(key);
        return null;
      }

      lobby.lastActivityAt = deps.now();
      if (lobby.hostId === playerId) promoteHost(lobby);
      return toLobbyState(lobby);
    },

    disconnect(code, playerId) {
      const lobby = lobbies.get(normalizeCode(code));
      if (!lobby) return null;
      const player = lobby.players.get(playerId);
      if (!player || !player.connected) return null;

      const now = deps.now();
      player.connected = false;
      player.disconnectedAt = now;
      lobby.lastActivityAt = now;
      if (lobby.hostId === playerId) promoteHost(lobby);
      return toLobbyState(lobby);
    },

    sweep() {
      const now = deps.now();
      const changed: LobbyState[] = [];
      const closed: { code: string; reason: LobbyClosedReason }[] = [];

      for (const [code, lobby] of lobbies) {
        let mutated = false;

        // Before kick-off a dropped player is only worth a minute. Once a game
        // is running the seat is held to the end, because losing somebody's
        // score to a sleeping phone is worse than a greyed-out row.
        if (lobby.status === "lobby") {
          for (const [id, player] of lobby.players) {
            if (player.connected || player.disconnectedAt === null) continue;
            if (now - player.disconnectedAt < LOBBY_DISCONNECT_GRACE_MS) continue;
            lobby.players.delete(id);
            mutated = true;
            if (lobby.hostId === id) promoteHost(lobby);
          }
        }

        if (lobby.players.size === 0) {
          lobbies.delete(code);
          closed.push({ code, reason: "empty" });
          continue;
        }

        let anyConnected = false;
        let emptySince = Number.NEGATIVE_INFINITY;
        for (const player of lobby.players.values()) {
          if (player.connected) {
            anyConnected = true;
            break;
          }
          emptySince = Math.max(emptySince, player.disconnectedAt ?? now);
        }

        if (!anyConnected && now - emptySince >= EMPTY_LOBBY_TTL_MS) {
          lobbies.delete(code);
          closed.push({ code, reason: "empty" });
          continue;
        }

        if (now - lobby.lastActivityAt >= IDLE_LOBBY_TTL_MS) {
          lobbies.delete(code);
          closed.push({ code, reason: "idle" });
          continue;
        }

        if (mutated) changed.push(toLobbyState(lobby));
      }

      return { changed, closed };
    },

    snapshot(code) {
      const lobby = lobbies.get(normalizeCode(code));
      return lobby ? toLobbyState(lobby) : null;
    },

    size() {
      return lobbies.size;
    },
  };
}
