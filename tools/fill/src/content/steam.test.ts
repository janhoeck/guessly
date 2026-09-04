import { describe, expect, it } from "vitest";
import { parseAppScreenshots, pickStoreApp } from "./steam.js";

const storeItem = (id: number, name: string, type = "app") => ({
  type,
  name,
  id,
  tiny_image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_231x87.jpg`,
  platforms: { windows: true, mac: false, linux: true },
});

describe("pickStoreApp", () => {
  it("takes the store's first app, which is the game itself almost always", () => {
    const picked = pickStoreApp(
      { total: 2, items: [storeItem(620, "Portal 2"), storeItem(400, "Portal")] },
      "Portal 2",
    );
    expect(picked).toEqual({ id: 620, name: "Portal 2" });
  });

  it("prefers the app whose title is the subject over the store's ranking", () => {
    const picked = pickStoreApp(
      { items: [storeItem(400, "Portal"), storeItem(620, "Portal 2")] },
      "portal 2",
    );
    expect(picked?.id).toBe(620);
  });

  it("never picks a soundtrack, a demo or a season pass, whatever the ranking says", () => {
    const picked = pickStoreApp(
      {
        items: [
          storeItem(323180, "Portal 2 Soundtrack"),
          storeItem(999, "Portal 2 Demo"),
          storeItem(998, "Portal 2 - Season Pass"),
          storeItem(620, "Portal 2"),
        ],
      },
      "Portal 2",
    );
    expect(picked?.id).toBe(620);
  });

  it("ignores what is not an app, and a payload that is not a search", () => {
    expect(pickStoreApp({ items: [storeItem(1, "Some Bundle", "bundle")] }, "x")).toBeNull();
    expect(pickStoreApp({ items: [] }, "x")).toBeNull();
    expect(pickStoreApp(undefined, "x")).toBeNull();
    expect(pickStoreApp({ items: [{ type: "app", id: "not a number", name: "Broken" }] }, "x")).toBeNull();
  });
});

describe("parseAppScreenshots", () => {
  const shot = (n: number) => ({
    id: n,
    path_thumbnail: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_${n}.600x338.jpg?t=1`,
    path_full: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_${n}.1920x1080.jpg?t=1`,
  });
  const details = (type: string, screenshots: unknown[]) => ({
    "620": { success: true, data: { type, name: "Portal 2", steam_appid: 620, screenshots } },
  });
  const app = { id: 620, name: "Portal 2" };

  it("reads the full-size renders, with the store page as the page to name", () => {
    const [first] = parseAppScreenshots(details("game", [shot(1)]), app);
    expect(first).toEqual({
      source: "steam",
      label: "Portal 2 — store screenshot 1",
      url: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_1.1920x1080.jpg?t=1",
      mime: "image/jpeg",
      width: 1920,
      height: 1080,
      description: "the publisher's own screenshot from the Steam store page",
      page: "https://store.steampowered.com/app/620",
      site: null,
    });
  });

  it("stops at five, which is plenty of the same game", () => {
    const found = parseAppScreenshots(details("game", [1, 2, 3, 4, 5, 6, 7].map(shot)), app);
    expect(found).toHaveLength(5);
    expect(found[4]?.label).toBe("Portal 2 — store screenshot 5");
  });

  it("offers nothing for what is not a game, or not this app, or not a success", () => {
    expect(parseAppScreenshots(details("music", [shot(1)]), app)).toEqual([]);
    expect(parseAppScreenshots({ "400": { success: true, data: { type: "game" } } }, app)).toEqual([]);
    expect(parseAppScreenshots({ "620": { success: false } }, app)).toEqual([]);
    expect(parseAppScreenshots(undefined, app)).toEqual([]);
  });

  it("skips a screenshot with no full-size render to speak of", () => {
    const found = parseAppScreenshots(
      details("game", [{ id: 0, path_thumbnail: "https://x.test/t.jpg" }, shot(2)]),
      app,
    );
    expect(found.map((image) => image.url)).toEqual([
      "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/ss_2.1920x1080.jpg?t=1",
    ]);
  });
});
