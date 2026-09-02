import { describe, expect, it } from "vitest";
import { sniffImage } from "./download.js";

const padded = (...head: number[]): Uint8Array => {
  const bytes = new Uint8Array(64);
  bytes.set(head);
  return bytes;
};

describe("sniffImage", () => {
  it("recognises the raster formats by their magic numbers", () => {
    expect(sniffImage(padded(0x89, 0x50, 0x4e, 0x47))?.extension).toBe("png");
    expect(sniffImage(padded(0xff, 0xd8, 0xff, 0xe0))?.extension).toBe("jpg");
    expect(sniffImage(padded(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))?.extension).toBe("gif");
    expect(
      sniffImage(padded(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)),
    ).toMatchObject({ contentType: "image/webp", extension: "webp" });
  });

  it("recognises an svg document, xml prolog and all", () => {
    const svg = new TextEncoder().encode(
      `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`,
    );
    expect(sniffImage(svg)).toMatchObject({ contentType: "image/svg+xml", extension: "svg" });
  });

  it("refuses an html page, even one with an inline svg icon in it", () => {
    const html = new TextEncoder().encode(
      `<!DOCTYPE html><html><body><svg width="1" height="1"></svg>Not found</body></html>`,
    );
    expect(sniffImage(html)).toBeNull();
  });

  it("refuses bytes too short to be any picture", () => {
    expect(sniffImage(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});
