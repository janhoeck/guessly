import {
  ALL_TOPIC_IDS,
  COUNTDOWN_DURATION_MS,
  EMPTY_LOBBY_TTL_MS,
  GUESS_MAX_LENGTH,
  IDLE_LOBBY_TTL_MS,
  INTERMISSION_DURATION_MS,
  LOBBY_DISCONNECT_GRACE_MS,
  MAX_PLAYERS_PER_LOBBY,
  MAX_TARGET_SCORE,
  MIN_PLAYERS_TO_START,
  MIN_TARGET_SCORE,
  MIN_TOPICS,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  ROUND_DURATION_MS,
  isTopicId,
  topicById,
  err,
  ok,
  type Ack,
  type AckFailure,
  type CreateLobbyPayload,
  type CreateLobbyResult,
  type ErrorCode,
  type GuessResult,
  type JoinLobbyPayload,
  type JoinLobbyResult,
  type LobbyClosedReason,
  type LobbyState,
  type LobbyStatus,
  type ResumeLobbyPayload,
  type ResumeLobbyResult,
  type RoundContent,
  type RoundKind,
  type TopicId,
} from "@guessly/protocol";
import { generateCode, generatePlayerId, generateToken, tokensMatch } from "./codes.js";
import { matchesAnswer } from "./matching.js";
import { pointsFor } from "./scoring.js";
import {
  toLobbyState,
  type LobbyRecord,
  type PlayerRecord,
  type RoundRecord,
} from "./types.js";

/**
 * Everything nondeterministic, injected. The clock is the obvious one, but
 * codes and tokens are the other two — collision retry is untestable without
 * being able to make the generator collide. `pickIndex` is the fourth: which
 * topic a round lands on is a rule worth testing, and `Math.random` is not
 * something a test can pin down.
 */
export interface LobbyStoreDeps {
  now: () => number;
  generateCode: () => string;
  generatePlayerId: () => string;
  generateToken: () => string;
  /** Chooses one of `length` options. Called once per round, for the topic. */
  pickIndex: (length: number) => number;
}

/**
 * What the content source is being asked for when a round opens.
 *
 * It is all plain data, on purpose: the store hands one of these out and never
 * learns how it gets answered, so an AI call, a fixture and a stub are the same
 * thing as far as the rules are concerned.
 */
export interface RoundRequest {
  code: string;
  /** 1-based. Every later transition quotes it back, which is what makes a
   *  slow answer to an abandoned round harmless. */
  number: number;
  topic: TopicId;
  kind: RoundKind;
  /** Answers this game has already used, so a source can avoid repeating one. */
  exclude: string[];
  /**
   * When the countdown reaches zero. The round may not start before it. On a
   * request from `prepareNext` this is only an estimate — see there.
   */
  startsAt: number;
}

/**
 * Everything a guess decides, in one return.
 *
 * Three separate things come out of one call because they go to three different
 * places, and splitting them into three calls would mean three chances for the
 * adapter to make a decision of its own. The store decides; the caller posts.
 */
export interface GuessOutcome {
  /** What goes back to the guesser, and to nobody else. */
  ack: Ack<GuessResult>;
  /**
   * The snapshot to broadcast, or null when nothing the room can see changed —
   * which is every wrong guess, because a miss is the guesser's business.
   */
  state: LobbyState | null;
  /**
   * Every connected player has now answered correctly. The twenty seconds exist
   * so that slower players still get a chance to score; when there are none
   * left, what is left of the clock is a locked field and a bar emptying in
   * front of people who are done.
   */
  complete: boolean;
}

/**
 * What happens when the intermission runs out: either somebody reached the
 * target and the game is over, or the next countdown opens and the content
 * source is asked for another round.
 */
export type AdvanceResult =
  | { kind: "finished"; state: LobbyState }
  | { kind: "next"; state: LobbyState; request: RoundRequest };

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
  setTopics(code: string, playerId: string, topics: TopicId[]): Ack<Record<string, never>>;
  /**
   * Opens the countdown and draws round one's topic. The ack is what the
   * content source needs to go and build the round — the caller is expected to
   * take it away and come back with `deliverRound` or `abandonRound`.
   */
  start(code: string, playerId: string): Ack<RoundRequest>;
  /**
   * The content arrived: the round goes live and the clock starts. Every
   * round-scoped call below quotes `number` back and returns null if it no
   * longer matches, so an answer that arrives after the lobby moved on is
   * dropped rather than played on top of whatever is happening now.
   */
  deliverRound(
    code: string,
    number: number,
    content: RoundContent,
    answer: string,
    aliases: string[],
  ): LobbyState | null;
  /**
   * Describes the round *after* the one being played, so its content can be
   * sourced while this one is still on screen instead of making the players
   * pay the full latency behind every countdown.
   *
   * The topic is drawn now and remembered, and `advance` reuses it — the
   * prefetched content has to be about the round that actually opens. The
   * request's `exclude` already carries this round's answer, which is not in
   * `usedAnswers` until the reveal. Its `startsAt` is only an estimate (the
   * countdown's zero if this round runs its clock out; an early finish moves it
   * sooner) — nothing schedules against it, because the real one is stamped by
   * `advance`. Null when the lobby is not playing the round quoted.
   */
  prepareNext(code: string, number: number): RoundRequest | null;
  /**
   * One guess, stamped when it arrived. Client timestamps are never consulted —
   * speed is the score here, so the only clock that counts is this one.
   */
  guess(code: string, playerId: string, roundNumber: number, guess: string): GuessOutcome;
  /** The 20 seconds are up: the answer goes on the wire and guessing closes. */
  revealRound(code: string, number: number): LobbyState | null;
  /**
   * The intermission is over. Either somebody has reached the target and the
   * lobby is finished, or the next round's countdown opens and a fresh request
   * goes out. Null if the lobby has moved on from the round quoted.
   */
  advance(code: string, number: number): AdvanceResult | null;
  /**
   * The content could not be built, but the game need not die for it: the same
   * round number gets a fresh countdown on a topic drawn *away* from the one
   * that failed — the commonest reason a build fails is that one topic's well
   * is dry, and the next shelf over is usually stocked. Falls back to the full
   * selection when avoiding would leave nothing. Null when the lobby is not on
   * that round's countdown any more; how often to try again is the caller's
   * decision, not this one's.
   */
  reopenRound(
    code: string,
    number: number,
    avoidTopic: TopicId,
  ): { state: LobbyState; request: RoundRequest } | null;
  /** The content could not be built. The lobby goes back to being a lobby. */
  abandonRound(code: string, number: number): LobbyState | null;
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

/**
 * The phases in which a lobby is being *set up* rather than played: before the
 * first round, and again once somebody has won and the room is deciding what to
 * play next. Starting a game is deliberately not on this list — see `start`.
 */
const CONFIGURABLE_STATUSES: readonly LobbyStatus[] = ["lobby", "finished"];

/**
 * Deduplicated and sorted into catalogue order, so a lobby's topics read the
 * same however the host clicked them and two identical selections are literally
 * equal.
 */
const normalizeTopics = (topics: readonly TopicId[]): TopicId[] => {
  const wanted = new Set<TopicId>(topics);
  return ALL_TOPIC_IDS.filter((id) => wanted.has(id));
};

const normalizeCode = (code: string): string => code.trim().toUpperCase();

/** Counted in code points, so an emoji costs one character and not two. */
const nicknameLength = (nickname: string): number => [...nickname].length;

export function createLobbyStore(overrides: Partial<LobbyStoreDeps> = {}): LobbyStore {
  const deps: LobbyStoreDeps = {
    now: Date.now,
    generateCode,
    generatePlayerId,
    generateToken,
    pickIndex: (length) => Math.floor(Math.random() * length),
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

  const checkTopics = (topics: unknown): AckFailure | null => {
    if (!Array.isArray(topics) || !topics.every(isTopicId)) {
      return { ok: false, error: "INVALID_TOPICS", message: "That is not a topic." };
    }
    // Counted after deduplication, so ["flags", "flags"] is one topic and not two.
    if (normalizeTopics(topics).length < MIN_TOPICS) {
      return {
        ok: false,
        error: "INVALID_TOPICS",
        message: `Pick at least ${MIN_TOPICS} topic.`,
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

  /**
   * Draws a topic from a list. The index is clamped rather than trusted: a
   * picker that returns nonsense should cost the round its randomness, not
   * take the server down in the middle of a game.
   */
  const pickFrom = (topics: readonly TopicId[]): TopicId | null => {
    if (topics.length === 0) return null;
    const raw = deps.pickIndex(topics.length);
    const index = Number.isInteger(raw) ? Math.min(Math.max(raw, 0), topics.length - 1) : 0;
    return topics[index] ?? null;
  };

  const pickTopic = (lobby: LobbyRecord): TopicId | null => pickFrom(lobby.topics);

  /**
   * Opens a countdown for a round that does not exist yet, and describes it to
   * whoever has to go and find the content.
   *
   * Round one and round nine both come through here, which is the point: "what
   * a fresh round looks like" is one piece of code rather than two that drift
   * apart the first time a field is added.
   */
  const openRound = (lobby: LobbyRecord, number: number, topic: TopicId, now: number): RoundRequest => {
    const round: RoundRecord = {
      number,
      topic,
      kind: topicById(topic).kind,
      // The countdown starts now and the content is fetched against it, so the
      // wait for the AI is spent watching a number fall rather than a spinner
      // turn. `in_round` is not reached until there is something to look at —
      // see deliverRound.
      startsAt: now + COUNTDOWN_DURATION_MS,
      endsAt: null,
      content: null,
      answer: null,
      aliases: [],
      results: [],
      revealed: false,
      intermissionEndsAt: null,
      nextTopic: null,
    };

    lobby.status = "countdown";
    lobby.round = round;
    lobby.lastActivityAt = now;

    return {
      code: lobby.code,
      number: round.number,
      topic: round.topic,
      kind: round.kind,
      exclude: [...lobby.usedAnswers],
      startsAt: round.startsAt,
    };
  };

  /**
   * Is there anybody left who could still answer this round?
   *
   * Only connected players count. A seat whose phone went to sleep is held to
   * the end of the game, but holding the round open for it as well would mean
   * every dropped player costs the room the rest of the clock.
   */
  const everybodyAnswered = (lobby: LobbyRecord, round: RoundRecord): boolean => {
    const answered = new Set(round.results.map((result) => result.playerId));
    let present = 0;
    for (const player of lobby.players.values()) {
      if (!player.connected) continue;
      present += 1;
      if (!answered.has(player.id)) return false;
    }
    return present > 0;
  };

  /**
   * A round-scoped transition only applies to the round it was issued for and
   * only from the phase it makes sense in. Everything else is a message about a
   * round that has already been abandoned, restarted, or finished.
   */
  const roundInPhase = (
    code: string,
    number: number,
    status: LobbyStatus,
  ): { lobby: LobbyRecord; round: RoundRecord } | null => {
    const lobby = lobbies.get(normalizeCode(code));
    if (!lobby || lobby.status !== status) return null;
    const round = lobby.round;
    if (!round || round.number !== number) return null;
    return { lobby, round };
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

  /**
   * The statuses are a parameter rather than a constant because the host powers
   * do not all open the same window: the target score and starting a game are
   * settled before kick-off, while topics can also be re-picked once a game has
   * been won.
   */
  const requireHost = (
    code: string,
    playerId: string,
    allowedStatuses: readonly LobbyStatus[],
  ): { lobby: LobbyRecord } | AckFailure => {
    const lobby = lobbies.get(normalizeCode(code));
    if (!lobby) return { ok: false, error: "LOBBY_NOT_FOUND", message: "That lobby no longer exists." };
    if (lobby.hostId !== playerId) {
      return { ok: false, error: "NOT_HOST", message: "Only the host can do that." };
    }
    if (!allowedStatuses.includes(lobby.status)) {
      return { ok: false, error: "GAME_IN_PROGRESS", message: "The game has already started." };
    }
    return { lobby };
  };

  return {
    create({ nickname, targetScore, topics }) {
      const name = nickname.trim();
      const nameError = checkNickname(name);
      if (nameError) return nameError;
      const targetError = checkTargetScore(targetScore);
      if (targetError) return targetError;
      const topicsError = checkTopics(topics);
      if (topicsError) return topicsError;

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
        topics: normalizeTopics(topics),
        players: new Map([[host.id, host]]),
        round: null,
        usedAnswers: [],
        createdAt: now,
        lastActivityAt: now,
      };
      lobbies.set(code, lobby);

      return ok({
        code,
        playerId: host.id,
        resumeToken: host.resumeToken,
        state: toLobbyState(lobby, now),
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

      return ok({
        playerId: player.id,
        resumeToken: player.resumeToken,
        state: toLobbyState(lobby, now),
      });
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

      return ok({ state: toLobbyState(lobby, now) });
    },

    setTarget(code, playerId, targetScore) {
      const host = requireHost(code, playerId, ["lobby"]);
      if ("ok" in host) return host;
      const targetError = checkTargetScore(targetScore);
      if (targetError) return targetError;

      host.lobby.targetScore = targetScore;
      host.lobby.lastActivityAt = deps.now();
      return ok({});
    },

    setTopics(code, playerId, topics) {
      const host = requireHost(code, playerId, CONFIGURABLE_STATUSES);
      if ("ok" in host) return host;
      const topicsError = checkTopics(topics);
      if (topicsError) return topicsError;

      host.lobby.topics = normalizeTopics(topics);
      host.lobby.lastActivityAt = deps.now();
      return ok({});
    },

    start(code, playerId) {
      const host = requireHost(code, playerId, ["lobby"]);
      if ("ok" in host) return host;

      let connected = 0;
      for (const player of host.lobby.players.values()) {
        if (player.connected) connected += 1;
      }
      if (connected < MIN_PLAYERS_TO_START) {
        return err("NOT_ENOUGH_PLAYERS", `You need ${MIN_PLAYERS_TO_START} players to start.`);
      }

      const topic = pickTopic(host.lobby);
      if (topic === null) {
        return err("INVALID_TOPICS", "This lobby has no topics to play.");
      }

      return ok(openRound(host.lobby, 1, topic, deps.now()));
    },

    deliverRound(code, number, content, answer, aliases) {
      const found = roundInPhase(code, number, "countdown");
      if (!found) return null;
      const { lobby, round } = found;

      const now = deps.now();
      // The countdown is a floor rather than a target. Content that turns up
      // early waits for it; content that turns up late starts the clock from
      // here, because handing somebody a round that is already half over is
      // worse than the extra second or two of waiting.
      const startsAt = Math.max(round.startsAt, now);

      round.content = content;
      round.answer = answer;
      round.aliases = aliases;
      round.startsAt = startsAt;
      round.endsAt = startsAt + ROUND_DURATION_MS;
      lobby.status = "in_round";
      lobby.lastActivityAt = now;
      return toLobbyState(lobby, now);
    },

    prepareNext(code, number) {
      const found = roundInPhase(code, number, "in_round");
      if (!found) return null;
      const { lobby, round } = found;

      const topic = pickTopic(lobby);
      if (topic === null) return null;
      round.nextTopic = topic;

      // This round's answer joins `usedAnswers` at the reveal, which has not
      // happened yet — without it here, the prefetch could serve it again.
      const exclude = [...lobby.usedAnswers];
      if (round.answer !== null) exclude.push(round.answer);

      return {
        code: lobby.code,
        number: number + 1,
        topic,
        kind: topicById(topic).kind,
        exclude,
        startsAt:
          (round.endsAt ?? deps.now()) + INTERMISSION_DURATION_MS + COUNTDOWN_DURATION_MS,
      };
    },

    guess(code, playerId, roundNumber, guess) {
      const refuse = (error: ErrorCode, message: string): GuessOutcome => ({
        ack: err(error, message),
        state: null,
        complete: false,
      });

      const lobby = lobbies.get(normalizeCode(code));
      if (!lobby) return refuse("LOBBY_NOT_FOUND", "That lobby no longer exists.");
      const player = lobby.players.get(playerId);
      if (!player) return refuse("LOBBY_NOT_FOUND", "You are not in that lobby.");

      const round = lobby.round;
      if (lobby.status !== "in_round" || !round || round.number !== roundNumber) {
        return refuse("ROUND_NOT_OPEN", "That round is not taking guesses.");
      }

      const attempt = guess.trim();
      if (!attempt || attempt.length > GUESS_MAX_LENGTH) {
        return refuse("INVALID_GUESS", `A guess is 1–${GUESS_MAX_LENGTH} characters.`);
      }
      if (round.results.some((result) => result.playerId === playerId)) {
        return refuse("ALREADY_ANSWERED", "You have already got this one.");
      }

      const now = deps.now();
      // The deadline is the deadline. The reveal runs off a timer and a timer
      // can be a few milliseconds late; without this, whether a guess on the
      // buzzer counted would depend on how busy the event loop was.
      if (round.endsAt !== null && now >= round.endsAt) {
        return refuse("ROUND_NOT_OPEN", "That round is over.");
      }

      // Somebody is playing, whether or not they got it right.
      lobby.lastActivityAt = now;

      if (round.answer === null || !matchesAnswer(attempt, round.answer, round.aliases)) {
        // Nothing the room can see has changed, so there is nothing to send it.
        return { ack: ok({ correct: false }), state: null, complete: false };
      }

      const elapsedMs = Math.max(0, now - round.startsAt);
      const points = pointsFor(elapsedMs);
      player.score += points;
      round.results.push({ playerId, elapsedMs, points });

      return {
        ack: ok({ correct: true, points, elapsedMs }),
        state: toLobbyState(lobby, now),
        complete: everybodyAnswered(lobby, round),
      };
    },

    revealRound(code, number) {
      const found = roundInPhase(code, number, "in_round");
      if (!found) return null;
      const { lobby, round } = found;

      const now = deps.now();
      round.revealed = true;
      round.intermissionEndsAt = now + INTERMISSION_DURATION_MS;
      lobby.status = "intermission";
      lobby.lastActivityAt = now;
      // Remembered so the next round does not serve the same thing again.
      if (round.answer !== null) lobby.usedAnswers.push(round.answer);
      return toLobbyState(lobby, now);
    },

    advance(code, number) {
      const found = roundInPhase(code, number, "intermission");
      if (!found) return null;
      const { lobby, round } = found;

      const now = deps.now();
      lobby.lastActivityAt = now;

      // Checked here rather than at the reveal so that the round somebody won
      // on still gets its intermission: the answer goes up, the scores settle,
      // and only then is the game over.
      const won = [...lobby.players.values()].some(
        (player) => player.score >= lobby.targetScore,
      );
      // The topic `prepareNext` drew, when it was asked — the prefetched
      // content is about that topic, so drawing afresh would orphan it.
      const topic = won ? null : (round.nextTopic ?? pickTopic(lobby));

      if (topic === null) {
        // `pickTopic` returning null is unreachable — a lobby is validated to
        // have at least one topic and cannot be re-picked mid-game — but a
        // lobby that could not build another round has nothing left to play,
        // and finishing says so rather than hanging on an intermission that
        // never ends.
        lobby.status = "finished";
        return { kind: "finished", state: toLobbyState(lobby, now) };
      }

      const request = openRound(lobby, number + 1, topic, now);
      return { kind: "next", state: toLobbyState(lobby, now), request };
    },

    reopenRound(code, number, avoidTopic) {
      const found = roundInPhase(code, number, "countdown");
      if (!found) return null;
      const { lobby } = found;

      const fresh = lobby.topics.filter((topic) => topic !== avoidTopic);
      const topic = pickFrom(fresh.length > 0 ? fresh : lobby.topics);
      if (topic === null) return null;

      const now = deps.now();
      const request = openRound(lobby, number, topic, now);
      return { state: toLobbyState(lobby, now), request };
    },

    abandonRound(code, number) {
      const found = roundInPhase(code, number, "countdown");
      if (!found) return null;
      const { lobby } = found;

      const now = deps.now();
      lobby.round = null;
      lobby.status = "lobby";
      lobby.lastActivityAt = now;
      return toLobbyState(lobby, now);
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

      const now = deps.now();
      lobby.lastActivityAt = now;
      if (lobby.hostId === playerId) promoteHost(lobby);
      return toLobbyState(lobby, now);
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
      return toLobbyState(lobby, now);
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

        if (mutated) changed.push(toLobbyState(lobby, now));
      }

      return { changed, closed };
    },

    snapshot(code) {
      const lobby = lobbies.get(normalizeCode(code));
      return lobby ? toLobbyState(lobby, deps.now()) : null;
    },

    size() {
      return lobbies.size;
    },
  };
}
