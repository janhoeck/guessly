import { describe, expect, it } from "vitest";
import { parseImagePages } from "./wikimedia.js";

/** A page as `formatversion=2` returns it, with the bits this module reads. */
const page = (
  title: string,
  info?: { width?: number; height?: number; mime?: string; description?: string; index?: number },
) => ({
  title,
  index: info?.index,
  imageinfo: [
    {
      width: info?.width ?? 1920,
      height: info?.height ?? 1080,
      mime: info?.mime ?? "image/png",
      ...(info?.description
        ? { extmetadata: { ImageDescription: { value: info.description } } }
        : {}),
    },
  ],
});

const payload = (...pages: unknown[]) => ({ batchcomplete: true, query: { pages } });

describe("parseImagePages", () => {
  it("reads a file into a candidate with a URL that can be submitted as-is", () => {
    const [found] = parseImagePages(
      payload(page("File:Screenshot from the Minecraft Nether.png")),
      "en",
    );

    expect(found).toMatchObject({
      source: "wikipedia",
      label: "Screenshot from the Minecraft Nether.png",
      width: 1920,
      height: 1080,
      page: null,
      site: null,
    });
    expect(found?.url).toBe(
      "https://en.wikipedia.org/wiki/Special:FilePath/Screenshot%20from%20the%20Minecraft%20Nether.png?width=1200",
    );
  });

  it("points a Commons hit at Commons", () => {
    const [found] = parseImagePages(payload(page("File:Flag of France.svg")), "commons");
    expect(found?.source).toBe("commons");
    expect(found?.url).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Flag%20of%20France.svg?width=1200",
    );
  });

  it("drops the wiki's own furniture, which every article carries", () => {
    const names = parseImagePages(
      payload(
        page("File:Commons-logo.svg", { width: 1024, height: 1376 }),
        page("File:Wikiquote-logo.svg", { width: 300, height: 355 }),
        page("File:OOjs UI icon edit-ltr-progressive.svg", { width: 800, height: 800 }),
        page("File:Symbol category class.svg", { width: 180, height: 185 }),
        page("File:Semi-protection-shackle.svg", { width: 240, height: 240 }),
        page("File:Noun-smartphone-apps-432831.svg", { width: 512, height: 960 }),
        page("File:Ionicons duplicate-sharp.svg", { width: 512, height: 512 }),
        page("File:Minecraft Creeper (Crop).png"),
      ),
      "en",
    ).map((image) => image.label);

    expect(names).toEqual(["Minecraft Creeper (Crop).png"]);
  });

  it("drops what is not a picture at all, and what is too small to be one", () => {
    const names = parseImagePages(
      payload(
        page("File:En-Minecraft-article.ogg", { mime: "application/ogg" }),
        page("File:Tiny glyph.png", { width: 20, height: 20 }),
        page("File:Wide but flat.png", { width: 900, height: 12 }),
        { title: "File:No imageinfo at all.png" },
        page("File:Red panda.jpg", { mime: "image/jpeg" }),
      ),
      "commons",
    ).map((image) => image.label);

    expect(names).toEqual(["Red panda.jpg"]);
  });

  it("honours the search ranking, which rides in `index` rather than in the order", () => {
    const names = parseImagePages(
      payload(
        page("File:Third.jpg", { index: 3 }),
        page("File:First.jpg", { index: 1 }),
        page("File:Second.jpg", { index: 2 }),
      ),
      "commons",
    ).map((image) => image.label);

    expect(names).toEqual(["First.jpg", "Second.jpg", "Third.jpg"]);
  });

  it("reduces a caption to a line of plain text", () => {
    const [found] = parseImagePages(
      payload(
        page("File:Camp Nou.jpg", {
          description: '<p>Interior of <a href="/wiki/Camp_Nou">Camp&nbsp;Nou</a></p>',
        }),
      ),
      "commons",
    );
    expect(found?.description).toBe("Interior of Camp Nou");
  });

  it("survives a payload that is not the one it asked for", () => {
    expect(parseImagePages(undefined, "en")).toEqual([]);
    expect(parseImagePages({ error: { code: "badvalue" } }, "en")).toEqual([]);
    expect(parseImagePages({ query: { pages: "nope" } }, "en")).toEqual([]);
  });
});
