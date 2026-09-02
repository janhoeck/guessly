import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeSourceFailure } from "./failure.js";

/**
 * The failures a real key runs into, and what each of them is allowed to say.
 * Built through the SDK's own `generate` so the subclass and the body-derived
 * `type` are the ones a live call would actually throw.
 */
const apiError = (status: number, type: string, message: string): APIError =>
  APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

const outOfCredit = () =>
  apiError(
    400,
    "invalid_request_error",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
  );

const cases: { name: string; error: unknown }[] = [
  { name: "out of credit", error: outOfCredit() },
  { name: "billing_error", error: apiError(400, "billing_error", "Billing issue.") },
  { name: "bad key", error: apiError(401, "authentication_error", "invalid x-api-key") },
  { name: "wrong workspace", error: apiError(403, "permission_error", "not allowed") },
  { name: "no such model", error: apiError(404, "not_found_error", "model not found") },
  { name: "rate limited", error: apiError(429, "rate_limit_error", "slow down") },
  { name: "overloaded", error: apiError(529, "overloaded_error", "overloaded") },
  { name: "a connection failure", error: new APIConnectionError({ message: "fetch failed" }) },
  { name: "a timeout", error: new APIConnectionTimeoutError() },
  { name: "something else entirely", error: new TypeError("undefined is not a function") },
];

describe("what the players are told", () => {
  it.each(cases)("keeps the wire out of the sentence for $name", ({ error }) => {
    const { message } = describeSourceFailure(error, "claude-opus-5");
    expect(message).not.toMatch(/\d{3}/);
    expect(message).not.toMatch(/anthropic|api key|\bkey\b/i);
    expect(message).toMatch(/\.$/);
  });

  it("does not blame the network for an account that is out of credit", () => {
    // The bug this whole module exists for: the API answered, in full, at once.
    expect(describeSourceFailure(outOfCredit(), "claude-opus-5").message).not.toMatch(
      /could not be reached/,
    );
  });

  it("says try again only when trying again could work", () => {
    const again = (error: unknown) =>
      /try again/.test(describeSourceFailure(error, "claude-opus-5").message);

    expect(again(apiError(429, "rate_limit_error", "slow down"))).toBe(true);
    expect(again(apiError(529, "overloaded_error", "overloaded"))).toBe(true);
    expect(again(outOfCredit())).toBe(false);
    expect(again(apiError(401, "authentication_error", "invalid x-api-key"))).toBe(false);
  });
});

describe("what the log is told", () => {
  it("names the balance, and where to fix it", () => {
    expect(describeSourceFailure(outOfCredit(), "claude-opus-5").detail).toMatch(
      /out of credit.*console\.anthropic\.com/,
    );
  });

  it("reads a billing_error without sniffing its text", () => {
    expect(describeSourceFailure(apiError(400, "billing_error", "Billing issue."), "m").detail).toMatch(
      /out of credit/,
    );
  });

  it("points at the key it was given", () => {
    expect(
      describeSourceFailure(apiError(401, "authentication_error", "invalid x-api-key"), "m").detail,
    ).toMatch(/ANTHROPIC_API_KEY was rejected \(401\)/);
  });

  it("names the model that does not exist", () => {
    expect(
      describeSourceFailure(apiError(404, "not_found_error", "model not found"), "claude-nope-9")
        .detail,
    ).toMatch(/ANTHROPIC_MODEL "claude-nope-9"/);
  });

  it("separates a timeout from a refused connection", () => {
    expect(describeSourceFailure(new APIConnectionTimeoutError(), "m").detail).toMatch(/timeout/);
    expect(
      describeSourceFailure(new APIConnectionError({ message: "fetch failed" }), "m").detail,
    ).toMatch(/could not connect/);
  });

  it("keeps a 400 that is this server's own fault, and quotes it", () => {
    const detail = describeSourceFailure(
      apiError(400, "invalid_request_error", "max_tokens: must be greater than 0"),
      "m",
    ).detail;
    expect(detail).toMatch(/rejected the request \(400\): max_tokens/);
  });
});
