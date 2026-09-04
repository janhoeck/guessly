import { describe, expect, it } from "vitest";
import { isFiltered, isNarrowed, languageChoice, parseRoundQuery, roundsHref } from "./query";

describe("parseRoundQuery", () => {
  it("reads every parameter it writes", () => {
    const query = parseRoundQuery({
      topic: "flags",
      kind: "image",
      language: "missing:de",
      q: "  france ",
      order: "disliked",
      page: "3",
    });
    expect(query).toEqual({
      filter: { topic: "flags", kind: "image", missingLanguage: "de", search: "france" },
      order: "disliked",
      page: 3,
    });
    expect(roundsHref(query)).toBe(
      "/rounds?topic=flags&kind=image&language=missing%3Ade&q=france&order=disliked&page=3",
    );
    expect(parseRoundQuery({ language: "de" }).filter).toEqual({ language: "de" });
  });

  it("ignores what it does not recognise, and lands on page one, newest first", () => {
    expect(
      parseRoundQuery({ topic: "memes", kind: "video", language: "fr", order: "best", page: "0" }),
    ).toEqual({ filter: {}, order: "newest", page: 1 });
    expect(parseRoundQuery({ page: "abc" }).page).toBe(1);
    expect(parseRoundQuery({ language: "missing:fr" }).filter).toEqual({});
    expect(parseRoundQuery({}).filter).toEqual({});
  });

  it("takes the first of a repeated parameter", () => {
    expect(parseRoundQuery({ topic: ["music", "flags"] }).filter.topic).toBe("music");
  });
});

describe("roundsHref", () => {
  it("is the bare list when nothing is narrowed", () => {
    expect(roundsHref({ filter: {}, order: "newest", page: 1 })).toBe("/rounds");
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ kind: "lyrics" })).toBe(true);
  });

  it("writes the order only when it is not the plain list", () => {
    expect(roundsHref({ filter: {}, order: "liked", page: 1 })).toBe("/rounds?order=liked");
    expect(roundsHref({ filter: {}, order: "newest", page: 2 })).toBe("/rounds?page=2");
  });

  it("round-trips through the parser", () => {
    const query = { filter: { topic: "music" as const, search: "100% & more" }, order: "liked" as const, page: 2 };
    const href = roundsHref(query);
    const params = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseRoundQuery(params)).toEqual(query);
  });
});

describe("isNarrowed", () => {
  it("counts a reordering as something to clear, though not as a filter", () => {
    expect(isNarrowed({ filter: {}, order: "newest", page: 3 })).toBe(false);
    expect(isNarrowed({ filter: { kind: "image" }, order: "newest", page: 1 })).toBe(true);
    expect(isNarrowed({ filter: {}, order: "disliked", page: 1 })).toBe(true);
    expect(isFiltered({})).toBe(false);
  });
});

describe("languageChoice", () => {
  it("names the one language question a filter asks", () => {
    expect(languageChoice({})).toBeNull();
    expect(languageChoice({ language: "en" })).toBe("en");
    expect(languageChoice({ missingLanguage: "de" })).toBe("missing:de");
  });
});
