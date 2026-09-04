import type { Server, Socket } from "socket.io";
import {
  err,
  ok,
  type Ack,
  type ClientToServerEvents,
  type CreateLobbyResult,
  type GuessResult,
  type InterServerEvents,
  type JoinLobbyResult,
  type LobbyListPayload,
  type LobbyState,
  type ResumeLobbyResult,
  type ServerToClientEvents,
  type SocketData,
} from "@guessly/protocol";
import type { RoundContentSource, RoundFeedback } from "../content/source.js";
import { createRoundRunner } from "../game/rounds.js";
import type { LobbyStore } from "../lobby/store.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import {
  parseCreate,
  parseGuess,
  parseJoin,
  parseResume,
  parseSetLanguage,
  parseSetTarget,
  parseSetTopics,
  parseVote,
} from "./validate.js";

export type GameServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

type Seat = { lobbyCode: string; playerId: string };

/**
 * The room every browsing socket sits in. `@` is not in the room-code
 * alphabet, so this can never be mistaken for a lobby of its own.
 */
const BROWSE_ROOM = "@browse";

export interface SocketAdapter {
  /** One reaping tick, turned into socket traffic. Driven by a single interval. */
  sweep(): void;
}

/**
 * The adapter. It owns exactly three things — which socket holds which seat,
 * which room a snapshot goes to, and answering the ack — and no rules. Every
 * decision below is the store's; this file only moves data between it and the
 * wire.
 */
export function registerSocketHandlers(
  io: GameServer,
  store: LobbyStore,
  source: RoundContentSource,
  feedback: RoundFeedback,
): SocketAdapter {
  /** `${code}:${playerId}` to socket id. One seat, one live socket. */
  const seats = new Map<string, string>();
  const seatKey = ({ lobbyCode, playerId }: Seat): string => `${lobbyCode}:${playerId}`;

  /** Socket ids watching the lobby list. Empty means the list costs nothing. */
  const browsers = new Set<string>();
  /**
   * What the browse room has already been told. Everyone in the room has seen
   * exactly this, which is what lets the push below be skipped: a lobby is
   * mutated by every guess in it and almost none of that is visible from
   * outside, so without the comparison a twelve-player game would spray the
   * same list at every browser twice a second.
   */
  let published = "";

  const publishList = (): void => {
    if (browsers.size === 0) return;
    const lobbies = store.list();
    const digest = JSON.stringify(lobbies);
    if (digest === published) return;
    published = digest;
    io.to(BROWSE_ROOM).emit("lobby:list", { lobbies });
  };

  /**
   * One mutation, posted to both audiences: the snapshot to the room it
   * happened in, and — if it changed anything visible from outside — the browse
   * list to whoever is watching for a game to join.
   *
   * A null state still publishes. It means "nothing the room can see changed",
   * and the commonest way to get one is the last seat leaving, which deletes
   * the lobby and is the most visible thing that can happen to the list.
   */
  const broadcast = (state: LobbyState | null): void => {
    if (state) io.to(state.code).emit("lobby:state", state);
    publishList();
  };

  /**
   * Countdowns, content and the round clock. It is built here rather than
   * handed in because it needs the two things only this file has: a way to
   * broadcast, and a room to broadcast into.
   */
  const runner = createRoundRunner({
    store,
    source,
    broadcast,
    onFailed: (code, message) => io.to(code).emit("round:failed", { message }),
  });

  const claimSeat = (socket: GameSocket, seat: Seat): void => {
    const key = seatKey(seat);
    const previous = seats.get(key);

    // Claim first, then evict: the stale socket's disconnect handler checks
    // this map, and must find the seat already rebound so it does not undo the
    // resume that just displaced it.
    seats.set(key, socket.id);
    if (previous !== undefined && previous !== socket.id) {
      io.sockets.sockets.get(previous)?.disconnect(true);
    }

    socket.data.lobbyCode = seat.lobbyCode;
    socket.data.playerId = seat.playerId;
    void socket.join(seat.lobbyCode);
  };

  /** Unbinds the socket's seat without touching the store. */
  const detachSeat = (socket: GameSocket): Seat | null => {
    const { lobbyCode, playerId } = socket.data;
    socket.data.lobbyCode = undefined;
    socket.data.playerId = undefined;
    if (!lobbyCode || !playerId) return null;

    const seat = { lobbyCode, playerId };
    if (seats.get(seatKey(seat)) === socket.id) seats.delete(seatKey(seat));
    void socket.leave(lobbyCode);
    return seat;
  };

  /** Leaves whatever lobby this socket was in, for real. */
  const releaseSeat = (socket: GameSocket): void => {
    const seat = detachSeat(socket);
    if (!seat) return;

    const left = store.leave(seat.lobbyCode, seat.playerId);
    broadcast(left);

    // The store drops a lobby the moment its last seat does, and finishes a
    // game the moment the second-to-last one does. Either way what is in
    // flight — a countdown, a request to the source, a round's clock — is for a
    // game nobody is playing, so it is dropped rather than left to time out
    // against a store that will refuse it anyway.
    //
    // Null is re-read rather than trusted: it also means "that player was not
    // in that lobby", which must not cancel a game still being played.
    const remaining = left ?? store.snapshot(seat.lobbyCode);
    if (remaining === null || remaining.status === "finished") {
      runner.cancel(seat.lobbyCode);
      return;
    }
    // Still a game, but a seat fewer. If what is left cannot field one, the
    // grace starts now.
    runner.rosterChanged(seat.lobbyCode);
  };

  /** Stops pushing the list at a socket that has moved on or gone away. */
  const stopBrowsing = (socket: GameSocket): void => {
    if (!browsers.delete(socket.id)) return;
    void socket.leave(BROWSE_ROOM);
  };

  const requireSeat = (socket: GameSocket): Ack<Seat> => {
    const { lobbyCode, playerId } = socket.data;
    if (!lobbyCode || !playerId || seats.get(`${lobbyCode}:${playerId}`) !== socket.id) {
      return err("LOBBY_NOT_FOUND", "This connection is not in a lobby.");
    }
    return ok({ lobbyCode, playerId });
  };

  /**
   * Rate limit, run, answer. Nothing gets past here without replying to the
   * caller, including a handler that throws — an unanswered ack is a client
   * that waits forever.
   */
  const run = <T>(ack: unknown, limiter: RateLimiter, body: () => Ack<T>): void => {
    if (typeof ack !== "function") return;
    const reply = ack as (result: Ack<T>) => void;

    if (!limiter.take()) {
      reply(err("RATE_LIMITED", "Slow down."));
      return;
    }

    try {
      reply(body());
    } catch (error) {
      console.error("[game] handler threw", error);
      reply(err("SERVER_ERROR", "Something went wrong on the server."));
    }
  };

  io.on("connection", (socket) => {
    const limiter = createRateLimiter();

    socket.on("lobby:create", (payload, ack) =>
      run<CreateLobbyResult>(ack, limiter, () => {
        const parsed = parseCreate(payload);
        if (!parsed.ok) return parsed;

        const created = store.create(parsed.data);
        if (!created.ok) return created;

        // Only give up the old seat once the new one is certain.
        releaseSeat(socket);
        claimSeat(socket, { lobbyCode: created.data.code, playerId: created.data.playerId });
        // No broadcast: the room is this socket, and the ack already carries
        // the state. The browse list is another matter — a new lobby is the
        // one thing everybody watching it is waiting for.
        publishList();
        return created;
      }),
    );

    socket.on("lobby:join", (payload, ack) =>
      run<JoinLobbyResult>(ack, limiter, () => {
        const parsed = parseJoin(payload);
        if (!parsed.ok) return parsed;

        const joined = store.join(parsed.data);
        if (!joined.ok) return joined;

        releaseSeat(socket);
        claimSeat(socket, {
          lobbyCode: joined.data.state.code,
          playerId: joined.data.playerId,
        });
        broadcast(joined.data.state);
        return joined;
      }),
    );

    socket.on("lobby:resume", (payload, ack) =>
      run<ResumeLobbyResult>(ack, limiter, () => {
        const parsed = parseResume(payload);
        if (!parsed.ok) return parsed;

        const resumed = store.resume(parsed.data);
        if (!resumed.ok) return resumed;

        claimSeat(socket, {
          lobbyCode: resumed.data.state.code,
          playerId: parsed.data.playerId,
        });
        broadcast(resumed.data.state);
        // Somebody is back. Whatever grace was counting down on this lobby is
        // restarted, and the store will find it has a game again.
        runner.rosterChanged(resumed.data.state.code);
        return resumed;
      }),
    );

    socket.on("lobby:browse", (ack) =>
      run<LobbyListPayload>(ack, limiter, () => {
        const lobbies = store.list();
        browsers.add(socket.id);
        void socket.join(BROWSE_ROOM);
        // Stamped here rather than left to the next change: this socket has
        // just been handed the list, so the room’s "everyone has seen this"
        // invariant still holds and the next push is still only sent if
        // something actually moved.
        published = JSON.stringify(lobbies);
        return ok({ lobbies });
      }),
    );

    socket.on("lobby:unbrowse", (ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        stopBrowsing(socket);
        return ok({});
      }),
    );

    socket.on("lobby:setTarget", (payload, ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;
        const parsed = parseSetTarget(payload);
        if (!parsed.ok) return parsed;

        const result = store.setTarget(seat.data.lobbyCode, seat.data.playerId, parsed.data.targetScore);
        if (result.ok) broadcast(store.snapshot(seat.data.lobbyCode));
        return result;
      }),
    );

    socket.on("lobby:setTopics", (payload, ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;
        const parsed = parseSetTopics(payload);
        if (!parsed.ok) return parsed;

        const result = store.setTopics(seat.data.lobbyCode, seat.data.playerId, parsed.data.topics);
        if (result.ok) broadcast(store.snapshot(seat.data.lobbyCode));
        return result;
      }),
    );

    socket.on("lobby:setLanguage", (payload, ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;
        const parsed = parseSetLanguage(payload);
        if (!parsed.ok) return parsed;

        const result = store.setLanguage(seat.data.lobbyCode, seat.data.playerId, parsed.data.language);
        if (result.ok) broadcast(store.snapshot(seat.data.lobbyCode));
        return result;
      }),
    );

    socket.on("lobby:start", (ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;

        const started = store.start(seat.data.lobbyCode, seat.data.playerId);
        if (!started.ok) return started;

        // The countdown is already ticking in this snapshot. The content is
        // fetched against it rather than before it, so the wait is spent
        // watching a number fall.
        broadcast(store.snapshot(seat.data.lobbyCode));
        runner.begin(started.data);
        return ok({});
      }),
    );

    socket.on("round:guess", (payload, ack) =>
      run<GuessResult>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;
        const parsed = parseGuess(payload);
        if (!parsed.ok) return parsed;

        const outcome = store.guess(
          seat.data.lobbyCode,
          seat.data.playerId,
          parsed.data.roundNumber,
          parsed.data.guess,
        );
        // Null for every wrong guess: a miss changes nothing anybody else can
        // see, so the room hears nothing about it.
        broadcast(outcome.state);
        // The store has decided there is nobody left to wait for. The clock
        // that would otherwise run the round out belongs to the runner.
        if (outcome.complete) {
          runner.finishEarly(seat.data.lobbyCode, parsed.data.roundNumber);
        }
        return outcome.ack;
      }),
    );

    socket.on("round:vote", (payload, ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        const seat = requireSeat(socket);
        if (!seat.ok) return seat;
        const parsed = parseVote(payload);
        if (!parsed.ok) return parsed;

        const outcome = store.vote(
          seat.data.lobbyCode,
          seat.data.playerId,
          parsed.data.roundNumber,
          parsed.data.vote,
        );
        // No broadcast: nothing the room can see has changed. The bank is
        // told behind the ack, and null is a round from a source with no
        // ledger — accepted, and nowhere to file it.
        if (outcome.record) void feedback.record(outcome.record);
        return outcome.ack;
      }),
    );

    socket.on("lobby:leave", (ack) =>
      run<Record<string, never>>(ack, limiter, () => {
        releaseSeat(socket);
        return ok({});
      }),
    );

    socket.on("disconnect", () => {
      stopBrowsing(socket);

      const { lobbyCode, playerId } = socket.data;
      if (!lobbyCode || !playerId) return;

      const key = `${lobbyCode}:${playerId}`;
      // The seat has already been rebound to a newer socket, so this drop is
      // the eviction that rebinding caused and means nothing.
      if (seats.get(key) !== socket.id) return;

      seats.delete(key);
      broadcast(store.disconnect(lobbyCode, playerId));
      // The seat is held — a drop is not a departure — but a game nobody is
      // left to play is still over. This starts the clock on that; coming back
      // before it runs out costs nothing.
      runner.rosterChanged(lobbyCode);
    });
  });

  return {
    sweep() {
      const { changed, closed } = store.sweep();

      for (const state of changed) io.to(state.code).emit("lobby:state", state);

      // Reaped lobbies and revived ones alike; the sweep is the only mutation
      // in the server that does not go through `broadcast`.
      publishList();

      for (const { code, reason } of closed) {
        runner.cancel(code);
        io.to(code).emit("lobby:closed", { reason });
        io.socketsLeave(code);
        for (const key of seats.keys()) {
          if (key.startsWith(`${code}:`)) seats.delete(key);
        }
      }
    },
  };
}
