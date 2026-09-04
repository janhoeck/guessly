import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  issueSession,
  passwordMatches,
  safeReturnPath,
  verifySession,
} from "./session";

const NOON = 1_700_000_000_000;

describe("sessions", () => {
  it("verifies a token it issued, for a week", async () => {
    const token = await issueSession("hunter2", NOON);
    expect(await verifySession(token, "hunter2", NOON)).toBe(true);
    expect(await verifySession(token, "hunter2", NOON + SESSION_TTL_MS - 1)).toBe(true);
    expect(await verifySession(token, "hunter2", NOON + SESSION_TTL_MS)).toBe(false);
  });

  it("refuses a token issued under another secret — so changing the password signs everybody out", async () => {
    const token = await issueSession("hunter2", NOON);
    expect(await verifySession(token, "hunter3", NOON)).toBe(false);
    expect(await verifySession(token, "", NOON)).toBe(false);
  });

  it("refuses a token whose expiry was moved", async () => {
    const token = await issueSession("hunter2", NOON);
    const [, signature] = token.split(".");
    expect(await verifySession(`${NOON + SESSION_TTL_MS * 10}.${signature}`, "hunter2", NOON)).toBe(false);
  });

  it("refuses anything that is not a token", async () => {
    for (const junk of ["", ".", "abc", "1700000000000.", "1700000000000.zz", "x.ff", "1e99.ff"]) {
      expect(await verifySession(junk, "hunter2", NOON)).toBe(false);
    }
  });
});

describe("passwordMatches", () => {
  it("matches the password and nothing near it", async () => {
    expect(await passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(await passwordMatches("hunter", "hunter2")).toBe(false);
    expect(await passwordMatches("hunter22", "hunter2")).toBe(false);
    expect(await passwordMatches("", "hunter2")).toBe(false);
    expect(await passwordMatches("Hunter2", "hunter2")).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("keeps a path on this site", () => {
    expect(safeReturnPath("/rounds?topic=flags&page=2")).toBe("/rounds?topic=flags&page=2");
    expect(safeReturnPath("/")).toBe("/");
  });

  it("sends anywhere else to the front page", () => {
    expect(safeReturnPath("https://evil.example/")).toBe("/");
    expect(safeReturnPath("//evil.example/")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("rounds")).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath(["/a", "/b"])).toBe("/");
  });
});
