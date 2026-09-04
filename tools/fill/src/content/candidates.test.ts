import { describe, expect, it } from "vitest";
import { chooseImage, orderCandidates } from "./candidates.js";
import type { DownloadedImage } from "./download.js";
import type { FoundImage } from "./search.js";
import type { ImageJudge, JudgeContext, Verdict } from "./vision.js";

const NEVER = new AbortController().signal;

const found = (url: string, page: string | null = null): FoundImage => ({
  source: "web",
  label: url,
  url,
  mime: "image/jpeg",
  width: 800,
  height: 600,
  description: null,
  page,
  site: null,
});

const picture = (url: string): DownloadedImage => ({
  bytes: Buffer.from(url),
  contentType: "image/jpeg",
  extension: "jpg",
  sourceUrl: url,
});

const context: JudgeContext = { subject: "Portal 2", question: "Which game?", answers: ["Portal 2"] };

/** Downloads what is on the list, and remembers what it was asked for. */
function downloader(available: readonly string[]) {
  const asked: { url: string; referer: string | null }[] = [];
  return {
    asked,
    download: async (url: string, referer: string | null) => {
      asked.push({ url, referer });
      return available.includes(url) ? picture(url) : null;
    },
  };
}

/** Judges by URL: anything listed is refused with that reason. */
const judgeRefusing = (refused: Record<string, string>): ImageJudge => ({
  async judge(image): Promise<Verdict> {
    const reason = refused[image.sourceUrl];
    return reason ? { accepted: false, reason } : { accepted: true, verified: true, note: null };
  },
});

describe("orderCandidates", () => {
  it("puts URLs the lookup showed first, in the model's order, and the model's own inventions last", () => {
    const known = new Map([
      ["https://a.test/1.jpg", found("https://a.test/1.jpg")],
      ["https://a.test/3.jpg", found("https://a.test/3.jpg")],
    ]);
    const ordered = orderCandidates(
      ["https://made.up/x.jpg", "https://a.test/1.jpg", "https://made.up/y.jpg", "https://a.test/3.jpg"],
      known,
    );
    expect(ordered.map((candidate) => candidate.url)).toEqual([
      "https://a.test/1.jpg",
      "https://a.test/3.jpg",
      "https://made.up/x.jpg",
      "https://made.up/y.jpg",
    ]);
    expect(ordered[0]?.found).not.toBeNull();
    expect(ordered[2]?.found).toBeNull();
  });
});

describe("chooseImage", () => {
  it("keeps the first candidate that downloads and passes, and names the page as the referer", async () => {
    const { download, asked } = downloader(["https://a.test/2.jpg"]);
    const lines: string[] = [];
    const choice = await chooseImage(
      [
        { url: "https://a.test/1.jpg", found: found("https://a.test/1.jpg", "https://a.test/page-1") },
        { url: "https://a.test/2.jpg", found: found("https://a.test/2.jpg", "https://a.test/page-2") },
        { url: "https://a.test/3.jpg", found: null },
      ],
      { download, judge: judgeRefusing({}), context, signal: NEVER, report: (line) => lines.push(line) },
    );

    expect(choice.image?.sourceUrl).toBe("https://a.test/2.jpg");
    expect(choice).toMatchObject({ verified: true });
    expect(asked).toEqual([
      { url: "https://a.test/1.jpg", referer: "https://a.test/page-1" },
      { url: "https://a.test/2.jpg", referer: "https://a.test/page-2" },
    ]);
    expect(choice.rejected).toEqual([
      { url: "https://a.test/1.jpg", reason: "it did not download as an image", downloaded: false },
    ]);
    expect(lines).toEqual([
      "candidate 1/3 did not download — https://a.test/1.jpg",
      "candidate 2/3 passed the vision check — https://a.test/2.jpg",
    ]);
  });

  it("moves past a picture the judge refuses, keeping the reason for the retry note", async () => {
    const { download } = downloader(["https://a.test/1.jpg", "https://a.test/2.jpg"]);
    const choice = await chooseImage(
      [
        { url: "https://a.test/1.jpg", found: null },
        { url: "https://a.test/2.jpg", found: null },
      ],
      {
        download,
        judge: judgeRefusing({ "https://a.test/1.jpg": 'the text "PORTAL 2" on it spells out "Portal 2"' }),
        context,
        signal: NEVER,
      },
    );
    expect(choice.image?.sourceUrl).toBe("https://a.test/2.jpg");
    expect(choice.rejected).toEqual([
      {
        url: "https://a.test/1.jpg",
        reason: 'the text "PORTAL 2" on it spells out "Portal 2"',
        downloaded: true,
      },
    ]);
  });

  it("comes back with every reason when nothing passes", async () => {
    const { download } = downloader(["https://a.test/1.jpg"]);
    const choice = await chooseImage(
      [
        { url: "https://a.test/1.jpg", found: null },
        { url: "https://a.test/2.jpg", found: null },
      ],
      {
        download,
        judge: judgeRefusing({ "https://a.test/1.jpg": "it is a poor picture: a menu" }),
        context,
        signal: NEVER,
      },
    );
    expect(choice.image).toBeNull();
    expect(choice.rejected.map((rejection) => rejection.downloaded)).toEqual([true, false]);
  });

  it("says when a picture went through unlooked-at, so the log does not read as a pass", async () => {
    const { download } = downloader(["https://a.test/1.jpg"]);
    const lines: string[] = [];
    const unverified: ImageJudge = {
      async judge() {
        return { accepted: true, verified: false, note: "the vision check failed: 502" };
      },
    };
    const choice = await chooseImage([{ url: "https://a.test/1.jpg", found: null }], {
      download,
      judge: unverified,
      context,
      signal: NEVER,
      report: (line) => lines.push(line),
    });
    expect(choice).toMatchObject({ verified: false });
    expect(lines[0]).toBe(
      "candidate 1/1 accepted unverified (the vision check failed: 502) — https://a.test/1.jpg",
    );
  });

  it("stops asking once the caller has given up", async () => {
    const controller = new AbortController();
    controller.abort();
    const { download, asked } = downloader(["https://a.test/1.jpg"]);
    const choice = await chooseImage([{ url: "https://a.test/1.jpg", found: null }], {
      download,
      judge: judgeRefusing({}),
      context,
      signal: controller.signal,
    });
    expect(choice.image).toBeNull();
    expect(asked).toHaveLength(0);
  });
});
