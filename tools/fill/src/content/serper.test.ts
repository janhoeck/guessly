import { afterEach, describe, expect, it, vi } from "vitest";
import { createSerperProvider, parseSerperResults } from "./serper.js";

const NEVER = new AbortController().signal;

/** One image as serper.dev's `/images` returns it. */
const image = (
  imageUrl: string,
  overrides: {
    title?: string;
    source?: string;
    domain?: string;
    link?: string;
    imageWidth?: number | null;
    imageHeight?: number | null;
  } = {},
) => ({
  title: overrides.title ?? "Portal 2 gameplay – IGN",
  imageUrl,
  imageWidth: overrides.imageWidth === undefined ? 1920 : overrides.imageWidth,
  imageHeight: overrides.imageHeight === undefined ? 1080 : overrides.imageHeight,
  thumbnailUrl: "https://encrypted-tbn0.gstatic.com/images?q=abc",
  thumbnailWidth: 275,
  thumbnailHeight: 183,
  source: overrides.source ?? "IGN",
  domain: overrides.domain ?? "www.ign.com",
  link: overrides.link ?? "https://www.ign.com/games/portal-2",
  googleUrl: "https://www.google.com/imgres?imgurl=...",
  position: 1,
});

describe("parseSerperResults", () => {
  it("reads an image into a candidate that names the page it was found on", () => {
    const [found] = parseSerperResults({
      searchParameters: { q: "Portal 2 gameplay screenshot", type: "images" },
      images: [image("https://assets.ign.test/portal2.jpg")],
    });
    expect(found).toEqual({
      source: "web",
      label: "Portal 2 gameplay – IGN",
      url: "https://assets.ign.test/portal2.jpg",
      mime: null,
      width: 1920,
      height: 1080,
      description: "IGN",
      page: "https://www.ign.com/games/portal-2",
      site: "ign.com",
    });
  });

  it("keeps a result that does not say its size, and drops one that says it is a thumbnail", () => {
    const found = parseSerperResults({
      images: [
        image("https://a.test/unsized.jpg", { imageWidth: null, imageHeight: null }),
        image("https://a.test/thumb.jpg", { imageWidth: 300, imageHeight: 200 }),
      ],
    });
    expect(found.map((item) => [item.url, item.width, item.height])).toEqual([
      ["https://a.test/unsized.jpg", 0, 0],
    ]);
  });

  it("refuses what is not https, and copes with a page that is not a URL", () => {
    const found = parseSerperResults({
      images: [
        image("http://plain.test/insecure.jpg"),
        image("https://fine.test/photo.jpg", { domain: "", link: "not a url" }),
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ url: "https://fine.test/photo.jpg", page: null, site: "fine.test" });
  });

  it("survives a payload that is not the one it asked for", () => {
    expect(parseSerperResults(undefined)).toEqual([]);
    expect(parseSerperResults({ message: "Unauthorized." })).toEqual([]);
    expect(parseSerperResults({ images: "nope" })).toEqual([]);
  });
});

describe("createSerperProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the whole query with the key in the header, and reads the answer", async () => {
    const fetch = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ images: [image("https://a.test/1.jpg")] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    const provider = createSerperProvider("key-1");
    const found = await provider.search(
      { subject: "Portal 2", lookingFor: "gameplay screenshot", topic: "games" },
      NEVER,
    );

    expect(found?.map((item) => item.url)).toEqual(["https://a.test/1.jpg"]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://google.serper.dev/images");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("key-1");
    expect(JSON.parse(String(init?.body))).toMatchObject({ q: "Portal 2 gameplay screenshot" });
  });

  it("rests for an hour after the account is refused, rather than asking every round", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ message: "Not enough credits" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetch);

    let now = 1_700_000_000_000;
    const provider = createSerperProvider("k", { now: () => now });
    const query = { subject: "Red panda", lookingFor: null, topic: "animals" as const };

    expect(await provider.search(query, NEVER)).toBeNull();
    expect(await provider.search(query, NEVER)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    now += 61 * 60_000;
    await provider.search(query, NEVER);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("answers null, not an empty list, when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(
      await createSerperProvider("k").search(
        { subject: "Red panda", lookingFor: null, topic: "animals" },
        NEVER,
      ),
    ).toBeNull();
  });
});
