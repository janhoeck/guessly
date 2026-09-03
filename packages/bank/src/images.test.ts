import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDiskImageStore, imageContentType, imageFilename } from "./images.js";
import { readS3Config } from "./s3.js";

/**
 * The parts of the image store that can be argued without a bucket: what names
 * it will answer to, and that a stored picture comes back byte for byte. The
 * S3 implementation's own conversation with a server is not testable here, so
 * what is tested instead is the thing both implementations share — the naming
 * rule, which is the only place a malformed name is refused — and the
 * environment reader, which is where a misconfigured deploy is caught.
 */

const hashOf = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const name = (bytes: Buffer, extension: string): string => `${hashOf(bytes)}.${extension}`;

describe("imageContentType", () => {
  const sixtyFour = "a".repeat(64);

  it("names the type for every format the store issues", () => {
    expect(imageContentType(`${sixtyFour}.png`)).toBe("image/png");
    expect(imageContentType(`${sixtyFour}.jpg`)).toBe("image/jpeg");
    expect(imageContentType(`${sixtyFour}.gif`)).toBe("image/gif");
    expect(imageContentType(`${sixtyFour}.webp`)).toBe("image/webp");
    expect(imageContentType(`${sixtyFour}.svg`)).toBe("image/svg+xml");
  });

  it("refuses anything that is not a name it could have issued", () => {
    // Traversal, in the two spellings a URL can carry it.
    expect(imageContentType("../../etc/passwd")).toBeNull();
    expect(imageContentType(`${sixtyFour}/../${sixtyFour}.png`)).toBeNull();
    // Not a SHA-256, or not one written the way the store writes them.
    expect(imageContentType("abc.png")).toBeNull();
    expect(imageContentType(`${"A".repeat(64)}.png`)).toBeNull();
    expect(imageContentType(`${"z".repeat(64)}.png`)).toBeNull();
    // A real hash, but a format the store does not serve — and no format.
    expect(imageContentType(`${sixtyFour}.tiff`)).toBeNull();
    expect(imageContentType(sixtyFour)).toBeNull();
    expect(imageContentType("")).toBeNull();
  });
});

describe("createDiskImageStore", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "guessly-images-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("names what it stores by the hash of the bytes, and hands the same bytes back", async () => {
    const store = createDiskImageStore(dir);
    await store.init();
    const bytes = randomBytes(2_048);

    const filename = await store.save({ bytes, extension: "png" });
    expect(filename).toBe(name(bytes, "png"));
    expect(filename).toBe(imageFilename({ bytes, extension: "png" }));

    await expect(store.has(filename)).resolves.toBe(true);
    const found = await store.open(filename);
    expect(found?.contentType).toBe("image/png");
    expect(found?.contentLength).toBe(bytes.length);

    const chunks: Buffer[] = [];
    for await (const chunk of found!.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(bytes)).toBe(true);
  });

  it("stores the same picture once, however many times it arrives", async () => {
    const store = createDiskImageStore(dir);
    await store.init();
    const bytes = randomBytes(64);

    expect(await store.save({ bytes, extension: "jpg" })).toBe(
      await store.save({ bytes, extension: "jpg" }),
    );
  });

  it("is a miss for a name it never issued, whatever is on the disk", async () => {
    const store = createDiskImageStore(dir);
    await store.init();
    // A real file under a name the store would never hand out. The refusal has
    // to come from the name, not from the file being absent — otherwise a
    // traversal that happens to hit something would be served.
    await writeFile(join(dir, "secret.txt"), "not a picture");

    expect(await store.has("secret.txt")).toBe(false);
    expect(await store.open("secret.txt")).toBeNull();
    expect(await store.open("../secret.txt")).toBeNull();
  });

  it("is a miss for a name it would have issued but does not hold", async () => {
    const store = createDiskImageStore(dir);
    await store.init();
    const missing = name(randomBytes(8), "png");

    expect(await store.has(missing)).toBe(false);
    expect(await store.open(missing)).toBeNull();
  });
});

describe("readS3Config", () => {
  const complete = {
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "guessly-images",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
  };

  it("reads a complete environment and defaults the region", () => {
    expect(readS3Config(complete, "apps/game")).toEqual({
      endpoint: "https://s3.example.com",
      region: "garage",
      bucket: "guessly-images",
      accessKeyId: "key",
      secretAccessKey: "secret",
    });
  });

  it("trims the trailing slash off the endpoint, so a key is never //-prefixed", () => {
    expect(readS3Config({ ...complete, S3_ENDPOINT: "https://s3.example.com//" }, "apps/game").endpoint).toBe(
      "https://s3.example.com",
    );
  });

  it("throws by name for each variable a deploy could have forgotten", () => {
    for (const key of Object.keys(complete)) {
      expect(() => readS3Config({ ...complete, [key]: "  " }, "apps/game")).toThrow(key);
    }
  });

  it("throws on an endpoint that is not an origin", () => {
    expect(() => readS3Config({ ...complete, S3_ENDPOINT: "s3.example.com" }, "apps/game")).toThrow(
      "S3_ENDPOINT",
    );
  });
});
