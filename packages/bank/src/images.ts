import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";

/** The bytes and the verified format — all the store needs to file a picture. */
export interface StorableImage {
  bytes: Buffer;
  /** Verified from the bytes by whoever downloaded it; names the file. */
  extension: string;
}

/**
 * Where the pictures live: objects named by the SHA-256 of their bytes.
 * Content addressing does three jobs at once — the same picture arriving twice
 * stores once, a name can never collide, and the name is safe to put in a URL
 * and cache forever, because a different picture is by definition a different
 * name.
 *
 * The store is an interface with two implementations because the pictures moved
 * off the server's own disk and into an object store: `createS3ImageStore` is
 * what the game and the fill tool run against, and `createDiskImageStore` is
 * the local one they used to share — kept for tests, which have no bucket.
 */

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * The only shape this store ever issues, and therefore the only shape the
 * image route will look up. Anything else — traversal attempts included — is
 * a 404 before the filesystem or the bucket is asked.
 */
const FILENAME = /^[0-9a-f]{64}\.[a-z0-9]+$/;

/**
 * The content type for a name this store could have issued, or null for one it
 * never would have. Pure and cheap on purpose: it is the check that runs
 * before any I/O, so a made-up name costs a regex rather than a round trip.
 */
export function imageContentType(filename: string): string | null {
  if (!FILENAME.test(filename)) return null;
  return CONTENT_TYPES[filename.slice(filename.indexOf(".") + 1)] ?? null;
}

/** A stored picture, opened for streaming straight into a response. */
export interface StoredImage {
  contentType: string;
  /** Null when the store cannot say — the response then goes out chunked. */
  contentLength: number | null;
  body: Readable;
}

export interface ImageStore {
  init(): Promise<void>;
  /** Writes the image and returns the filename to bank alongside the round. */
  save(image: StorableImage): Promise<string>;
  /**
   * Whether the store already holds this name — false, rather than null, for
   * one it never issued. It exists so a caller that only wants a yes or no
   * does not have to download a picture to get one.
   */
  has(filename: string): Promise<boolean>;
  /**
   * Opens a stored picture for reading. Null for a name this store never
   * issued *and* for one it did but no longer holds — both are a 404 to the
   * browser, and telling them apart would only tell a prober which is which.
   * Throws when the store itself could not be reached, which is a different
   * thing and deserves a different status.
   */
  open(filename: string): Promise<StoredImage | null>;
}

/** The SHA-256 name a picture will be stored under. */
export function imageFilename(image: StorableImage): string {
  return `${createHash("sha256").update(image.bytes).digest("hex")}.${image.extension}`;
}

/**
 * A directory of files. What the bank used before the pictures moved to the
 * object store, and what the tests still use — a temp directory needs no
 * credentials and no network.
 */
export function createDiskImageStore(dir: string): ImageStore {
  return {
    async init() {
      await mkdir(dir, { recursive: true });
    },

    async save(image) {
      const filename = imageFilename(image);
      // Overwriting is idempotent by construction: same name, same bytes.
      await writeFile(join(dir, filename), image.bytes);
      return filename;
    },

    async has(filename) {
      if (imageContentType(filename) === null) return false;
      try {
        await stat(join(dir, filename));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },

    async open(filename) {
      const contentType = imageContentType(filename);
      if (contentType === null) return null;

      const path = join(dir, filename);
      let contentLength: number;
      try {
        contentLength = (await stat(path)).size;
      } catch (error) {
        // Missing is a 404; anything else is the disk failing and should be
        // heard rather than swallowed into a "not found".
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
      return { contentType, contentLength, body: createReadStream(path) };
    },
  };
}
