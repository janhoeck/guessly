import type { LobbyState } from "@guessly/protocol";
import { RoundSourceError, type RoundContentSource } from "../content/source.js";
import type { LobbyStore, RoundRequest } from "../lobby/store.js";

/**
 * The round's moving parts: the countdown, the request for content, and the
 * clock that ends the round.
 *
 * This is where the impurity lives on purpose. The store decides everything and
 * touches nothing — no timers, no network — and this file does the opposite: it
 * owns the timers and the in-flight request, and every decision it makes it
 * makes by asking the store. That is also why each call quotes the round number
 * back: a slow answer to a round that has since been abandoned is refused by
 * the store rather than guarded against here.
 */

export interface RoundRunner {
  /** Takes a freshly opened round from `store.start` and sees it through. */
  begin(request: RoundRequest): void;
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

  return {
    begin(request) {
      // A lobby only ever has one round in flight. Whatever was there belonged
      // to a game that has already been abandoned.
      stop(request.code);

      const run: Running = { controller: new AbortController(), timers: new Set() };
      running.set(request.code, run);

      /**
       * The countdown is a promise so it can be awaited alongside the content
       * rather than nested inside it: the round goes live when *both* are done,
       * which is the whole reason the players get a countdown instead of a
       * spinner.
       */
      const countdown = new Promise<void>((resolve) => {
        after(run, request.startsAt, resolve);
      });

      void (async () => {
        try {
          const [sourced] = await Promise.all([
            deps.source.build(request, run.controller.signal),
            countdown,
          ]);

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

          after(run, endsAt, () => {
            deps.broadcast(deps.store.revealRound(request.code, request.number));
            settle(request.code, run);
          });
        } catch (error) {
          // Cancelled rather than failed: the lobby is already gone or has
          // started something else, and there is nobody left to apologise to.
          if (run.controller.signal.aborted) return;

          console.error(`[game] ${request.code} round ${request.number} failed`, error);
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
    },

    cancel(code) {
      stop(code);
    },
  };
}
