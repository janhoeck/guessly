import type { LobbyState } from "@guessly/protocol";
import {
  RoundSourceError,
  type RoundContentSource,
  type SourcedRound,
} from "../content/source.js";
import type { LobbyStore, RoundRequest } from "../lobby/store.js";

/**
 * The game's moving parts: the countdown, the request for content, the clock
 * that ends a round, and the pause before the next one opens.
 *
 * This is where the impurity lives on purpose. The store decides everything and
 * touches nothing — no timers, no network — and this file does the opposite: it
 * owns the timers and the in-flight request, and every decision it makes it
 * makes by asking the store. That is also why each call quotes the round number
 * back: a slow answer to a round that has since been abandoned is refused by
 * the store rather than guarded against here.
 *
 * A game is one run and many rounds. `begin` starts the chain and each round's
 * intermission either links to the next or stops on a winner, so `intermission`
 * is a phase the server drives rather than a screen somebody has to press a
 * button to leave.
 */

export interface RoundRunner {
  /** Takes a freshly opened round from `store.start` and sees the game through. */
  begin(request: RoundRequest): void;
  /**
   * Nobody is left to answer, so the round need not run its clock out. Quotes
   * the round number back, so a call that arrives a beat late does nothing.
   */
  finishEarly(code: string, number: number): void;
  /** Drops whatever is in flight for a lobby. Safe to call for a lobby with nothing running. */
  cancel(code: string): void;
}

export interface RoundRunnerDeps {
  store: LobbyStore;
  source: RoundContentSource;
  /** Nulls are the store saying "nobody to tell"; swallowed here for the caller. */
  broadcast: (state: LobbyState | null) => void;
  /** Why a lobby just landed back in the lobby, in a sentence players can read. */
  onFailed: (code: string, message: string) => void;
}

interface Running {
  controller: AbortController;
  timers: Set<NodeJS.Timeout>;
  /** The round this run is currently on. */
  number: number;
  /**
   * Ends that round now instead of at `endsAt`. Set once the round goes live
   * and cleared the moment it is used, so the clock and an early finish can
   * both fire and only one of them counts.
   */
  finish: (() => void) | null;
  /**
   * Content for the round after the one on screen, fetched while it plays so
   * the intermission is not spent waiting on the network. Resolves null when
   * the fetch failed — never rejects — and `play` then builds the round
   * against its countdown exactly as if nothing had been prefetched.
   */
  prefetch: { number: number; sourced: Promise<SourcedRound | null> } | null;
  /**
   * The round number that has already been given its one second chance on a
   * fresh topic, so a build that fails twice ends the game instead of looping.
   */
  retriedNumber: number | null;
}

export function createRoundRunner(deps: RoundRunnerDeps): RoundRunner {
  const running = new Map<string, Running>();

  const stop = (code: string): void => {
    const current = running.get(code);
    if (!current) return;
    running.delete(code);
    current.controller.abort();
    for (const timer of current.timers) clearTimeout(timer);
    current.timers.clear();
    current.finish = null;
    current.prefetch = null;
  };

  /** Ends this lobby's run only if it is still the run that started it. */
  const settle = (code: string, run: Running): void => {
    if (running.get(code) === run) stop(code);
  };

  const after = (run: Running, at: number, body: () => void): void => {
    const timer = setTimeout(() => {
      run.timers.delete(timer);
      body();
    }, Math.max(0, at - Date.now()));
    run.timers.add(timer);
  };

  /**
   * One round: its countdown, its content, its twenty seconds. `reveal` picks
   * the chain up from there, and calls back into here for the round after.
   */
  const play = (run: Running, request: RoundRequest): void => {
    run.number = request.number;
    run.finish = null;

    /**
     * The countdown is a promise so it can be awaited alongside the content
     * rather than nested inside it: the round goes live when *both* are done,
     * which is the whole reason the players get a countdown instead of a
     * spinner.
     */
    const countdown = new Promise<void>((resolve) => {
      after(run, request.startsAt, resolve);
    });

    // Sourced while the previous round was on screen, when there was one to
    // source behind. A prefetch that failed resolves null instead of
    // rejecting, and the round is then built against the countdown as if it
    // had never been asked for — the prefetch is a head start, not a new way
    // for a round to fail.
    const held = run.prefetch?.number === request.number ? run.prefetch : null;
    run.prefetch = null;
    const content = held
      ? held.sourced.then(
          (early) => early ?? deps.source.build(request, run.controller.signal),
        )
      : deps.source.build(request, run.controller.signal);

    void (async () => {
      try {
        const [sourced] = await Promise.all([content, countdown]);

        const state = deps.store.deliverRound(
          request.code,
          request.number,
          sourced.content,
          sourced.answer,
          sourced.aliases,
        );
        // The store refused it: the lobby moved on while we were asking.
        if (!state) return settle(request.code, run);

        console.log(
          `[game] ${request.code} round ${request.number} (${request.topic}): ${sourced.subject}`,
        );
        deps.broadcast(state);

        const endsAt = state.round?.endsAt;
        if (endsAt == null) return settle(request.code, run);

        // Two things can end a round — the clock, and the last player still
        // typing getting it — and whichever arrives first makes the other a
        // no-op. A round revealed twice would award its intermission twice.
        let ended = false;
        const end = (): void => {
          if (ended) return;
          ended = true;
          run.finish = null;
          reveal(run, request);
        };

        run.finish = end;
        after(run, endsAt, end);

        // The round is live, so its twenty seconds are spent fetching the next
        // one — by the time the intermission ends the content is usually
        // already in hand and the countdown is the only wait left. A winner or
        // a reaped lobby makes this a wasted call; that is bounded at one.
        const next = deps.store.prepareNext(request.code, request.number);
        if (next) {
          run.prefetch = {
            number: next.number,
            sourced: deps.source.build(next, run.controller.signal).catch((error) => {
              if (!run.controller.signal.aborted) {
                console.warn(
                  `[game] ${next.code} round ${next.number} prefetch failed; will build against the countdown`,
                  error,
                );
              }
              return null;
            }),
          };
        }
      } catch (error) {
        // Cancelled rather than failed: the lobby is already gone or has
        // started something else, and there is nobody left to apologise to.
        if (run.controller.signal.aborted) return;

        // The reason goes on the headline rather than only inside the cause
        // chain: the first line is the one that gets read and pasted.
        const detail = error instanceof RoundSourceError ? error.detail : undefined;
        console.error(
          `[game] ${request.code} round ${request.number} failed${detail ? `: ${detail}` : ""}`,
          error,
        );

        // One fresh topic before the game is given up on: the commonest build
        // failure is a single topic with nothing sourceable left, and the next
        // shelf over is usually a stocked one in the bank. The players see the
        // countdown start again, which is a hiccup; being dumped back to the
        // lobby on round eight is a catastrophe.
        if (run.retriedNumber !== request.number) {
          run.retriedNumber = request.number;
          const reopened = deps.store.reopenRound(
            request.code,
            request.number,
            request.topic,
          );
          if (reopened) {
            console.log(
              `[game] ${request.code} round ${request.number}: retrying on ${reopened.request.topic}`,
            );
            deps.broadcast(reopened.state);
            play(run, reopened.request);
            return;
          }
        }

        const state = deps.store.abandonRound(request.code, request.number);
        if (state) {
          deps.broadcast(state);
          deps.onFailed(
            request.code,
            error instanceof RoundSourceError
              ? error.message
              : "The round could not be built.",
          );
        }
        settle(request.code, run);
      }
    })();
  };

  /** The answer, the standings, and then whatever comes next. */
  const reveal = (run: Running, request: RoundRequest): void => {
    const revealed = deps.store.revealRound(request.code, request.number);
    if (!revealed) return settle(request.code, run);
    deps.broadcast(revealed);

    const opensAt = revealed.round?.intermissionEndsAt;
    if (opensAt == null) return settle(request.code, run);

    after(run, opensAt, () => {
      const advanced = deps.store.advance(request.code, request.number);
      if (!advanced) return settle(request.code, run);

      deps.broadcast(advanced.state);
      // Somebody reached the target. There is no next round to open, and the
      // lobby is already `finished` in the snapshot that just went out.
      if (advanced.kind === "finished") return settle(request.code, run);

      play(run, advanced.request);
    });
  };

  return {
    begin(request) {
      // A lobby only ever has one game in flight. Whatever was there belonged
      // to a game that has already been abandoned.
      stop(request.code);

      const run: Running = {
        controller: new AbortController(),
        timers: new Set(),
        number: request.number,
        finish: null,
        prefetch: null,
        retriedNumber: null,
      };
      running.set(request.code, run);
      play(run, request);
    },

    finishEarly(code, number) {
      const run = running.get(code);
      if (!run || run.number !== number) return;
      run.finish?.();
    },

    cancel(code) {
      stop(code);
    },
  };
}
