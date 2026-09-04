import { describe, expect, it } from "vitest";
import { USER_AGENT, headersFor } from "./download.js";

describe("headersFor", () => {
  it("gives Wikimedia the descriptive agent its policy asks for, and no referer", () => {
    for (const url of [
      "https://upload.wikimedia.org/wikipedia/commons/a/a1/Red_panda.jpg",
      "https://commons.wikimedia.org/wiki/Special:FilePath/Red%20panda.jpg?width=1200",
      "https://en.wikipedia.org/wiki/Special:FilePath/Portal2.png?width=1200",
    ]) {
      expect(headersFor(url, "https://en.wikipedia.org/wiki/Red_panda")).toEqual({
        "user-agent": USER_AGENT,
        accept: "image/*",
      });
    }
  });

  it("looks like a browser everywhere else, naming the page the picture belongs to", () => {
    const headers = headersFor(
      "https://assets.ign.test/portal2.jpg",
      "https://www.ign.com/games/portal-2",
    );
    expect(headers["user-agent"]).toMatch(/^Mozilla\/5\.0 /);
    expect(headers.referer).toBe("https://www.ign.com/games/portal-2");
    expect(headers.accept).toContain("image/webp");
  });

  it("sends no referer when the search did not say where the picture was found", () => {
    expect(headersFor("https://cdn.steam.test/ss_1.jpg", null)).not.toHaveProperty("referer");
  });

  it("is not tricked by a lookalike host into the archive's agent", () => {
    expect(headersFor("https://wikipedia.org.evil.test/x.jpg", null)["user-agent"]).toMatch(/Mozilla/);
    expect(headersFor("https://notwikimedia.org/x.jpg", null)["user-agent"]).toMatch(/Mozilla/);
  });

  it("copes with something that is not a URL at all", () => {
    expect(headersFor("not a url", null)["user-agent"]).toMatch(/Mozilla/);
  });
});
