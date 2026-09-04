import { describe, expect, it } from "vitest";
import { isFiltered, languageChoice, parseRoundQuery, roundsHref } from "./query";

describe("parseRoundQuery", () => {
  it("reads every parameter it writes", () => {
    const query = parseRoundQuery({
      topic: "flags",
      kind: "image",
      language: "missing:de",
      q: "  france ",
      page: "3",
    });
    expect(query).toEqual({
      filter: { topic: "flags", kind: "image", missingLanguage: "de", search: "france" },
      page: 3,
    });
    expect(roundsHref(query)).toBe("/rounds?topic=flags&kind=image&language=missing%3Ade&q=france&page=3");
    expect(parseRoundQuery({ language: "de" }).filter).toEqual({ language: "de" });
  });

  it("ignores what it does not recognise, and lands on page one", () => {
    expect(parseRoundQuery({ topic: "memes", kind: "video", language: "fr", page: "0" })).toEqual({
      filter: {},
      page: 1,
    });
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
    expect(roundsHref({ filter: {}, page: 1 })).toBe("/rounds");
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ kind: "lyrics" })).toBe(true);
  });

  it("round-trips through the parser", () => {
    const query = { filter: { topic: "music" as const, search: "100% & more" }, page: 2 };
    const href = roundsHref(query);
    const params = Object.fromEntries(new URL(`http://x${href}`).searchParams);
    expect(parseRoundQuery(params)).toEqual(query);
  });
});

describe("languageChoice", () => {
  it("names the one language question a filter asks", () => {
    expect(languageChoice({})).toBeNull();
    expect(languageChoice({ language: "en" })).toBe("en");
    expect(languageChoice({ missingLanguage: "de" })).toBe("missing:de");
  });
});
