import { describe, expect, it } from "vitest";
import {
  formatImageResults,
  merge,
  searchImages,
  type FoundImage,
  type ImageProvider,
  type ImageQuery,
} from "./search.js";

const NEVER = new AbortController().signal;

const image = (label: string, overrides: Partial<FoundImage> = {}): FoundImage => ({
  source: "commons",
  label,
  url: `https://example.test/${label}`,
  mime: "image/jpeg",
  width: 800,
  height: 600,
  description: null,
  page: null,
  site: null,
  ...overrides,
});

const labels = (images: readonly FoundImage[]) => images.map((found) => found.label);

const lane = (images: FoundImage[], weight = 1) => ({ images, weight });

/** A provider that answers with what it is given, and remembers being asked. */
function provider(
  name: string,
  answer: FoundImage[] | null,
  options: { placement?: "lead" | "lane"; weight?: number; topics?: readonly string[] } = {},
): ImageProvider & { asked: ImageQuery[] } {
  const asked: ImageQuery[] = [];
  return {
    name,
    asked,
    placement: options.placement ?? "lane",
    ...(options.weight === undefined ? {} : { weight: options.weight }),
    appliesTo: (topic) => (options.topics ? options.topics.includes(topic) : true),
    async search(query) {
      asked.push(query);
      return answer;
    },
  };
}

const query = (subject: string, topic: ImageQuery["topic"] = "animals"): ImageQuery => ({
  subject,
  lookingFor: null,
  topic,
});

describe("merge", () => {
  it("alternates the lanes, so neither source can spend the whole list", () => {
    const merged = merge(
      [],
      [
        lane([image("article 1"), image("article 2"), image("article 3")]),
        lane([image("search 1"), image("search 2"), image("search 3")]),
      ],
      6,
    );
    expect(labels(merged)).toEqual([
      "article 1",
      "search 1",
      "article 2",
      "search 2",
      "article 3",
      "search 3",
    ]);
  });

  it("gives a weighted lane its weight's worth of slots per turn", () => {
    const merged = merge(
      [],
      [
        lane([image("web 1"), image("web 2"), image("web 3"), image("web 4")], 2),
        lane([image("wiki 1"), image("wiki 2")]),
        lane([image("commons 1"), image("commons 2")]),
      ],
      8,
    );
    expect(labels(merged)).toEqual([
      "web 1",
      "web 2",
      "wiki 1",
      "commons 1",
      "web 3",
      "web 4",
      "wiki 2",
      "commons 2",
    ]);
  });

  it("puts the lead in front, in its own order, before any lane", () => {
    const merged = merge(
      [image("shot 1"), image("shot 2")],
      [lane([image("web 1")]), lane([image("wiki 1")])],
      10,
    );
    expect(labels(merged)).toEqual(["shot 1", "shot 2", "web 1", "wiki 1"]);
  });

  it("leaves the slots of a lane that runs out to the others", () => {
    const merged = merge(
      [],
      [lane([image("only article")]), lane([image("s1"), image("s2"), image("s3")])],
      4,
    );
    expect(labels(merged)).toEqual(["only article", "s1", "s2", "s3"]);
  });

  it("offers a picture two sources found exactly once", () => {
    const merged = merge(
      [],
      [
        lane([image("Shared", { url: "https://example.test/Shared.jpg" })]),
        lane([image("shared again", { url: "https://example.test/shared.jpg" }), image("Other")]),
      ],
      4,
    );
    expect(labels(merged)).toEqual(["Shared", "Other"]);
  });

  it("stops at the limit", () => {
    expect(
      merge([image("lead")], [lane([image("a"), image("b")]), lane([image("c"), image("d")])], 3),
    ).toHaveLength(3);
  });

  it("copes with no lanes at all, and with a lane of nothing", () => {
    expect(labels(merge([image("lead")], [], 5))).toEqual(["lead"]);
    expect(merge([], [lane([])], 5)).toEqual([]);
  });
});

describe("searchImages", () => {
  it("asks every provider that applies to the topic, and only those", async () => {
    const steam = provider("steam", [image("shot", { source: "steam" })], {
      placement: "lead",
      topics: ["games"],
    });
    const wiki = provider("wikipedia", [image("article")]);

    const animals = await searchImages(query("Red panda"), [steam, wiki], NEVER);
    expect(animals).toMatchObject({ ok: true, counts: { wikipedia: 1 } });
    expect(steam.asked).toHaveLength(0);

    const games = await searchImages(query("Portal 2", "games"), [steam, wiki], NEVER);
    expect(games).toMatchObject({ ok: true, counts: { steam: 1, wikipedia: 1 } });
    if (!games.ok) throw new Error("unreachable");
    expect(labels(games.images)).toEqual(["shot", "article"]);
  });

  it("lets a provider's weight decide how much of the list it gets", async () => {
    const web = provider("web", [image("web 1"), image("web 2"), image("web 3")], { weight: 2 });
    const wiki = provider("wikipedia", [image("wiki 1"), image("wiki 2")]);
    const result = await searchImages(query("Inception"), [web, wiki], NEVER);
    if (!result.ok) throw new Error("unreachable");
    expect(labels(result.images)).toEqual(["web 1", "web 2", "wiki 1", "web 3", "wiki 2"]);
  });

  it("tells a provider that could not be reached apart from one that found nothing", async () => {
    const result = await searchImages(
      query("Red panda"),
      [provider("web", null), provider("commons", [])],
      NEVER,
    );
    expect(result).toMatchObject({ ok: true, images: [], counts: { web: null, commons: 0 } });
  });

  it("reports the search as failed only when every provider was unreachable", async () => {
    const result = await searchImages(
      query("Red panda"),
      [provider("web", null), provider("commons", null)],
      NEVER,
    );
    expect(result).toEqual({ ok: false, reason: "The image search could not be reached." });
  });

  it("refuses an empty query before asking anybody", async () => {
    const wiki = provider("wikipedia", [image("article")]);
    const result = await searchImages(query("   "), [wiki], NEVER);
    expect(result).toEqual({ ok: false, reason: "The query was empty." });
    expect(wiki.asked).toHaveLength(0);
  });

  it("hands the providers a trimmed query with looking_for folded to null when empty", async () => {
    const wiki = provider("wikipedia", []);
    await searchImages({ subject: "  Portal 2 ", lookingFor: "  ", topic: "games" }, [wiki], NEVER);
    expect(wiki.asked[0]).toEqual({ subject: "Portal 2", lookingFor: null, topic: "games" });
  });
});

describe("formatImageResults", () => {
  it("lists every picture with its source tag and its URL on its own line, ready to copy", () => {
    const text = formatImageResults(
      {
        ok: true,
        counts: {},
        images: [
          image("Portal 2 — store screenshot 1", {
            source: "steam",
            url: "https://cdn.steam.test/ss_1.1920x1080.jpg",
            width: 1920,
            height: 1080,
            description: "the publisher's own screenshot from the Steam store page",
          }),
          image("Portal 2 review", {
            source: "web",
            site: "ign.com",
            url: "https://ign.test/portal2.jpg",
            width: 0,
            height: 0,
          }),
          image("Red panda.jpg", { source: "wikipedia" }),
          image("Ailurus fulgens.jpg", { source: "commons" }),
        ],
      },
      query("Portal 2", "games"),
    );

    expect(text).toContain(
      "- [Steam screenshot] Portal 2 — store screenshot 1 (1920×1080) — the publisher's own screenshot from the Steam store page\n  https://cdn.steam.test/ss_1.1920x1080.jpg",
    );
    expect(text).toContain("- [web: ign.com] Portal 2 review\n  https://ign.test/portal2.jpg");
    expect(text).toContain("- [Wikipedia] Red panda.jpg (800×600)");
    expect(text).toContain("- [Commons] Ailurus fulgens.jpg (800×600)");
    expect(text).toMatch(/4 picture\(s\) found for "Portal 2"/);
  });

  it("names what was asked for, so the model knows which search this answers", () => {
    const text = formatImageResults(
      { ok: true, counts: {}, images: [] },
      { subject: "Zelda", lookingFor: "gameplay screenshot", topic: "games" },
    );
    expect(text).toMatch(/No pictures found for "Zelda gameplay screenshot"/);
    expect(text).toMatch(/different subject/);
  });

  it("hands a lookup failure back as a sentence rather than as nothing", () => {
    const text = formatImageResults(
      { ok: false, reason: "The image search could not be reached." },
      query("Red panda"),
    );
    expect(text).toMatch(/could not be reached/);
  });
});
