import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createS3ImageStore, imageContentType, readS3Config } from "@guessly/bank";
import { loadEnvFile } from "./config.js";

/**
 * The one-way move: every picture the bank filed on disk, into the bucket.
 *
 * `pnpm migrate:images` — run once when the images move off `DATA_DIR`, and
 * again with no harm if it was interrupted. There is nothing to undo and
 * nothing to get wrong twice: the objects are named by the SHA-256 of their
 * bytes exactly as the files were, so a picture that is already in the bucket
 * is skipped and one that is uploaded twice is written to the same key with
 * the same content. That is the whole reason this is a script and not a
 * migration with a plan.
 *
 * It **verifies before it uploads**. A file whose name does not match the hash
 * of what is inside it is not the picture the bank thinks it banked, and
 * carrying that into the bucket would preserve the corruption rather than the
 * round. Same for a name the store would never have issued. Both are reported
 * and skipped, and the exit code says whether anything was left behind — the
 * database still points at those names, so a skip is a round to go and look at
 * rather than a line to scroll past.
 *
 * Nothing is deleted. The directory stays exactly as it was until somebody who
 * has read the summary removes it.
 */

/** Where the pictures were, before. The server's old `DATA_DIR`/images. */
const DEFAULT_DIR = fileURLToPath(new URL("../../../apps/game/data/images", import.meta.url));

/** Enough at once to keep the link busy, few enough to stay a polite guest. */
const CONCURRENCY = 6;

loadEnvFile();

// Deliberately not `loadFillConfig`: moving files needs a bucket, not an API
// key, and demanding DEEPSEEK_API_KEY to run a migration would be a puzzle
// rather than a check.
const s3 = readS3Config(process.env, "tools/fill");
const dir = (process.env.DATA_DIR ?? "").trim()
  ? join((process.env.DATA_DIR ?? "").trim(), "images")
  : DEFAULT_DIR;

const images = createS3ImageStore(s3);
await images.init();

let names: string[];
try {
  names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log(`[migrate] nothing to do: ${dir} does not exist`);
    process.exit(0);
  }
  throw error;
}

console.log(
  `[migrate] ${names.length} file${names.length === 1 ? "" : "s"} in ${dir} -> ${s3.bucket} at ${s3.endpoint}`,
);

const uploaded: string[] = [];
const skipped: string[] = [];
const alreadyThere: string[] = [];
const failed: { name: string; reason: unknown }[] = [];

/** One file: check the name, check the bytes, upload unless it is already in. */
const migrate = async (name: string): Promise<void> => {
  if (imageContentType(name) === null) {
    skipped.push(`${name}: not a name the image store issues`);
    return;
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(join(dir, name));
  } catch (error) {
    failed.push({ name, reason: error });
    return;
  }

  // The name *is* the checksum, so this is free integrity checking — and the
  // only chance to notice a picture that rotted on disk while there is still
  // a copy of it in front of us.
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== name.slice(0, name.indexOf("."))) {
    skipped.push(`${name}: contents hash to ${hash.slice(0, 12)}…, so the file is not what it is named`);
    return;
  }

  // Cheaper than re-uploading a hundred megabytes on a second run, and the
  // only reason a second run is a comfortable thing to do.
  try {
    if (await images.has(name)) {
      alreadyThere.push(name);
      return;
    }
  } catch (error) {
    failed.push({ name, reason: error });
    return;
  }

  try {
    const key = await images.save({ bytes, extension: name.slice(name.indexOf(".") + 1) });
    // The store names the object itself; if it disagreed with the filename the
    // database would be pointing at something that is not there.
    if (key !== name) {
      failed.push({ name, reason: new Error(`stored as ${key}`) });
      return;
    }
    uploaded.push(name);
  } catch (error) {
    failed.push({ name, reason: error });
  }
};

// A fixed pool rather than Promise.all over 356 files: the point is to keep a
// few uploads in flight, not to open one connection per picture.
let next = 0;
const done = () => uploaded.length + alreadyThere.length + skipped.length + failed.length;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, names.length) }, async () => {
    while (next < names.length) {
      const name = names[next++]!;
      await migrate(name);
      if (done() % 25 === 0) console.log(`[migrate] ${done()}/${names.length}`);
    }
  }),
);

console.log(
  `[migrate] ${uploaded.length} uploaded, ${alreadyThere.length} already in the bucket, ${skipped.length} skipped, ${failed.length} failed`,
);
for (const reason of skipped) console.warn(`[migrate] skipped ${reason}`);
for (const { name, reason } of failed) console.error(`[migrate] failed ${name}`, reason);

if (skipped.length > 0 || failed.length > 0) {
  console.error(
    `[migrate] ${skipped.length + failed.length} picture${skipped.length + failed.length === 1 ? "" : "s"} did not make it — the rounds pointing at them will 404 until they do. ${dir} has been left untouched.`,
  );
  process.exit(1);
}

console.log(`[migrate] every picture is in the bucket. ${dir} can be deleted.`);
