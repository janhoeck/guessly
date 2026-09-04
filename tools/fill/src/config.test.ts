import { describe, expect, it } from "vitest";
import { ALL_TOPIC_IDS } from "@guessly/protocol";
import { parseFillArgs } from "./config.js";

describe("parseFillArgs", () => {
  it("asks for the whole stockroom when nothing was said", () => {
    expect(parseFillArgs([])).toEqual({ topics: null });
  });

  it("confines the run to one topic, in either spelling", () => {
    expect(parseFillArgs(["--topic", "flags"])).toEqual({ topics: ["flags"] });
    expect(parseFillArgs(["--topic=music"])).toEqual({ topics: ["music"] });
  });

  it("takes several — repeated or comma-separated — deduplicated into catalogue order", () => {
    expect(parseFillArgs(["--topic", "music", "--topic=games,flags", "--topic", "music"])).toEqual({
      topics: ["flags", "games", "music"],
    });
  });

  it("ignores the separator pnpm and turbo forward", () => {
    expect(parseFillArgs(["--", "--topic", "flags"])).toEqual({ topics: ["flags"] });
  });

  it("refuses a topic the catalogue does not have, and names the catalogue", () => {
    expect(() => parseFillArgs(["--topic", "cars"])).toThrow(/Unknown topic "cars"/);
    expect(() => parseFillArgs(["--topic", "cars"])).toThrow(ALL_TOPIC_IDS.join(", "));
  });

  it("refuses --topic without an id", () => {
    expect(() => parseFillArgs(["--topic"])).toThrow(/needs a topic id/);
    expect(() => parseFillArgs(["--topic="])).toThrow(/needs a topic id/);
    expect(() => parseFillArgs(["--topic", "--topic", "flags"])).toThrow(/needs a topic id/);
  });

  it("refuses an argument it does not know rather than filling everything", () => {
    expect(() => parseFillArgs(["--topics", "flags"])).toThrow(/Unknown argument "--topics"/);
    expect(() => parseFillArgs(["flags"])).toThrow(/Unknown argument "flags"/);
  });
});
