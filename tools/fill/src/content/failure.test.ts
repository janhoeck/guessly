import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { describe, expect, it } from "vitest";
import { describeSourceFailure } from "./failure.js";

/**
 * The failures a real key runs into, and what each of them is allowed to say.
 * Built through the SDK's own `generate` so the subclass and the body-derived
 * fields are the ones a live call would actually throw. The bodies mirror
 * what api.deepseek.com really sends — an empty balance is a 402, a missing
 * model a 400 whose message says "Model Not Exist".
 */
const apiError = (status: number, message: string): APIError =>
  APIError.generate(
    status,
    { error: { message, type: "invalid_request_error", param: null, code: null } },
    undefined,
    new Headers(),
  );

const outOfCredit = () => apiError(402, "Insufficient Balance");
const unknownModel = () => apiError(400, "Model Not Exist");

const cases: { name: string; error: unknown }[] = [
  { name: "out of credit", error: outOfCredit() },
  { name: "bad key", error: apiError(401, "Authentication Fails (no such user)") },
  { name: "no such model", error: unknownModel() },
  { name: "invalid params", error: apiError(422, "Invalid max_tokens value") },
  { name: "rate limited", error: apiError(429, "Rate limit reached") },
  { name: "overloaded", error: apiError(503, "Server is overloaded") },
  { name: "a server error", error: apiError(500, "Internal error") },
  { name: "a connection failure", error: new APIConnectionError({ message: "fetch failed" }) },
  { name: "a timeout", error: new APIConnectionTimeoutError() },
  { name: "something else entirely", error: new TypeError("undefined is not a function") },
];

describe("what the players are told", () => {
  it.each(cases)("keeps the wire out of the sentence for $name", ({ error }) => {
    const { message } = describeSourceFailure(error, "deepseek-v4-pro");
    expect(message).not.toMatch(/\d{3}/);
    expect(message).not.toMatch(/deepseek|api key|\bkey\b/i);
    expect(message).toMatch(/\.$/);
  });

  it("does not blame the network for an account that is out of credit", () => {
    // The bug this whole module exists for: the API answered, in full, at once.
    expect(describeSourceFailure(outOfCredit(), "deepseek-v4-pro").message).not.toMatch(
      /could not be reached/,
    );
  });

  it("says try again only when trying again could work", () => {
    const again = (error: unknown) =>
      /try again/.test(describeSourceFailure(error, "deepseek-v4-pro").message);

    expect(again(apiError(429, "Rate limit reached"))).toBe(true);
    expect(again(apiError(503, "Server is overloaded"))).toBe(true);
    expect(again(outOfCredit())).toBe(false);
    expect(again(apiError(401, "Authentication Fails"))).toBe(false);
  });
});

describe("what the log is told", () => {
  it("names the balance, and where to fix it", () => {
    expect(describeSourceFailure(outOfCredit(), "deepseek-v4-pro").detail).toMatch(
      /out of credit.*platform\.deepseek\.com/,
    );
  });

  it("points at the key it was given", () => {
    expect(
      describeSourceFailure(apiError(401, "Authentication Fails"), "m").detail,
    ).toMatch(/DEEPSEEK_API_KEY was rejected \(401\)/);
  });

  it("names the model that does not exist, from the 400 DeepSeek actually sends", () => {
    expect(describeSourceFailure(unknownModel(), "deepseek-nope-9").detail).toMatch(
      /DEEPSEEK_MODEL "deepseek-nope-9"/,
    );
  });

  it("reads a plain 404 as a missing model too", () => {
    expect(describeSourceFailure(apiError(404, "Not Found"), "deepseek-nope-9").detail).toMatch(
      /DEEPSEEK_MODEL "deepseek-nope-9"/,
    );
  });

  it("separates a timeout from a refused connection", () => {
    expect(describeSourceFailure(new APIConnectionTimeoutError(), "m").detail).toMatch(/timeout/);
    expect(
      describeSourceFailure(new APIConnectionError({ message: "fetch failed" }), "m").detail,
    ).toMatch(/could not connect/);
  });

  it("keeps a 400 that is this server's own fault, and quotes it", () => {
    const detail = describeSourceFailure(
      apiError(400, "max_tokens: must be greater than 0"),
      "m",
    ).detail;
    expect(detail).toMatch(/rejected the request \(400\): max_tokens/);
  });
});
