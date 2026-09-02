import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadedImage } from "../content/download.js";

/**
 * Where the pictures live: a directory of files named by the SHA-256 of their
 * bytes. Content addressing does three jobs at once — the same picture arriving
 * twice stores once, a filename can never collide, and the name is safe to put
 * in a URL and cache forever, because a different picture is by definition a
 * different name.
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
 * a 404 before the filesystem is asked.
 */
const FILENAME = /^[0-9a-f]{64}\.[a-z0-9]+$/;

export interface ImageStore {
  init(): Promise<void>;
  /** Writes the image and returns the filename to bank alongside the round. */
  save(image: DownloadedImage): Promise<string>;
  /** Path and content type for a stored filename; null for a name we never issued. */
  resolve(filename: string): { path: string; contentType: string } | null;
}

export function createImageStore(dir: string): ImageStore {
  return {
    async init() {
      await mkdir(dir, { recursive: true });
    },

    async save(image) {
      const hash = createHash("sha256").update(image.bytes).digest("hex");
      const filename = `${hash}.${image.extension}`;
      // Overwriting is idempotent by construction: same name, same bytes.
      await writeFile(join(dir, filename), image.bytes);
      return filename;
    },

    resolve(filename) {
      if (!FILENAME.test(filename)) return null;
      const contentType = CONTENT_TYPES[filename.slice(filename.indexOf(".") + 1)];
      if (contentType === undefined) return null;
      return { path: join(dir, filename), contentType };
    },
  };
}
