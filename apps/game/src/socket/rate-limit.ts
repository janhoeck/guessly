import { RATE_LIMIT_EVENTS_PER_SEC } from "@guessly/protocol";

export interface RateLimiter {
  /** Spends one event's budget. False means the caller is over their allowance. */
  take(): boolean;
}

/**
 * A token bucket per socket. It refills continuously rather than in windows, so
 * a client that paces itself is never refused, while one that floods is cut off
 * after a single burst instead of every second on the second.
 */
export function createRateLimiter(
  now: () => number = Date.now,
  eventsPerSecond: number = RATE_LIMIT_EVENTS_PER_SEC,
): RateLimiter {
  let tokens = eventsPerSecond;
  let refilledAt = now();

  return {
    take() {
      const at = now();
      const elapsed = Math.max(0, at - refilledAt);
      tokens = Math.min(eventsPerSecond, tokens + (elapsed / 1000) * eventsPerSecond);
      refilledAt = at;

      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
