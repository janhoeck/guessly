import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";

/**
 * What went wrong with a request to the model, said twice: once for the people
 * watching a countdown, and once for whoever is running the server.
 *
 * Those are different audiences and collapsing them into one sentence is what
 * made this worth writing. Every failure used to read "The content source could
 * not be reached", which sent somebody looking for a network fault when the API
 * had in fact answered at once, in full, to say the account behind the key had
 * run out of credit.
 *
 * The players' half says only what is useful from a player's seat: whether
 * trying again might work. A rejected key, a missing model and an empty balance
 * are one thing from where they are sitting — the server is broken and the host
 * cannot fix it by pressing start again — so they share a sentence, and the log
 * gets the four different reasons.
 */
export interface SourceFailure {
  /** Goes to the lobby, in `round:failed`. */
  message: string;
  /** Goes to the server log, next to the underlying error. */
  detail: string;
}

/** Nothing anybody in the lobby does will fix these. They are the operator's. */
const MISCONFIGURED = "The AI is not set up properly on this server.";
/** Nobody's fault, and worth another go in a minute. */
const BUSY = "The AI is busy right now — try again in a moment.";
const STRUGGLING = "The AI is having trouble right now — try again in a moment.";
/** Now says what it means: the request never got an answer. */
const UNREACHABLE = "The content source could not be reached.";

/** The API's own message for the failure, if the body carried one. */
function bodyMessage(error: APIError): string | undefined {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const message = body?.error?.message;
  return typeof message === "string" ? message : undefined;
}

/**
 * An exhausted balance arrives as a plain `invalid_request_error` rather than
 * the `billing_error` the type union has room for, so both are checked and the
 * text is sniffed for the one that is not self-describing. If that wording ever
 * changes this falls through to the generic 4xx below — still honest, just less
 * useful — which is the right way for a guess about someone else's copy to fail.
 */
function isOutOfCredit(error: APIError): boolean {
  if (error.type === "billing_error") return true;
  if (error.status !== 400) return false;
  return /credit balance|purchase credits/i.test(bodyMessage(error) ?? error.message);
}

export function describeSourceFailure(error: unknown, model: string): SourceFailure {
  // Most specific first: a timeout is a connection error is an APIError.
  if (error instanceof APIConnectionTimeoutError) {
    return {
      message: "The AI took too long to answer.",
      detail: "api.anthropic.com did not answer within the request timeout",
    };
  }
  if (error instanceof APIConnectionError) {
    return { message: UNREACHABLE, detail: "could not connect to api.anthropic.com" };
  }
  // No status means the request never became a response — an aborted call, or
  // something thrown on the way out that is not the API's doing at all.
  if (!(error instanceof APIError) || error.status === undefined) {
    return { message: UNREACHABLE, detail: "the request failed before the API answered" };
  }

  if (isOutOfCredit(error)) {
    return {
      message: MISCONFIGURED,
      detail:
        "the account behind ANTHROPIC_API_KEY is out of credit — add credits at console.anthropic.com/settings/billing",
    };
  }

  switch (error.status) {
    case 401:
      return {
        message: MISCONFIGURED,
        detail: "ANTHROPIC_API_KEY was rejected (401) — check the key in tools/fill/.env (or apps/game/.env, its fallback)",
      };
    case 403:
      return {
        message: MISCONFIGURED,
        detail: `ANTHROPIC_API_KEY may not use ${model} (403) — check the key's workspace`,
      };
    case 404:
      return {
        message: MISCONFIGURED,
        detail: `ANTHROPIC_MODEL ${JSON.stringify(model)} does not exist (404)`,
      };
    case 429:
      return { message: BUSY, detail: "rate limited by api.anthropic.com (429)" };
  }

  if (error.status >= 500) {
    return { message: STRUGGLING, detail: `api.anthropic.com returned ${error.status}` };
  }

  // Every other 4xx is this server asking wrongly rather than the API failing,
  // so it reads as misconfiguration to the lobby and as a defect in the log.
  return {
    message: MISCONFIGURED,
    detail: `api.anthropic.com rejected the request (${error.status}): ${bodyMessage(error) ?? error.message}`,
  };
}
