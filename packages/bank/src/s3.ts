import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { imageContentType, imageFilename, type ImageStore } from "./images.js";

/**
 * The pictures, in an object store.
 *
 * This is where the bank's images actually live: a bucket, one object per
 * round, named by the SHA-256 of its bytes exactly as the old directory named
 * its files. Moving them off the server's disk is what lets the game server be
 * a process rather than a process *plus a volume* — a deploy that loses its
 * filesystem now loses nothing, and the fill tool on a laptop writes the same
 * pictures the deployed server reads.
 *
 * **The bucket stays private.** Players never talk to it; the game server
 * reads objects out of it and serves them from its own origin at
 * `/img/<hash>.<ext>`, which is the URL the bank has always handed out. So the
 * credentials live in one process, there is no CORS to configure, no bucket to
 * make world-readable, and the URL in a banked round means the same thing it
 * did when the file was on disk.
 */

export interface S3ImageStoreConfig {
  /** The S3 API origin, e.g. "https://s3-abc.example.com". */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** How long a browser may keep a picture. Content-addressed, so: forever. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export function createS3ImageStore(config: S3ImageStoreConfig): ImageStore {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    /**
     * Garage routes virtual-host requests by a `root_domain` that is not the
     * domain this endpoint is published on, so `bucket.host` would not resolve
     * to anything. Path style — `host/bucket/key` — is what every S3-compatible
     * store understands without being told where it lives.
     */
    forcePathStyle: true,
    /**
     * The SDK adds CRC32 checksum headers to every request by default and
     * insists on them coming back. That is an AWS conversation, and a
     * store that does not join in fails requests that were otherwise fine —
     * so it is asked for only where the operation genuinely requires it.
     */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    async init() {
      // Fail at boot rather than at the first round. A bucket that is missing,
      // a key that was revoked and an endpoint nobody can reach all look
      // identical from a lobby waiting on a picture, and identical to each
      // other — here they arrive with the store's own words on them.
      try {
        await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      } catch (error) {
        throw new Error(
          `The image bucket ${JSON.stringify(config.bucket)} could not be reached at ${config.endpoint} — check S3_BUCKET, the credentials, and that the bucket exists.`,
          { cause: error },
        );
      }
    },

    async save(image) {
      const filename = imageFilename(image);
      // Overwriting is idempotent by construction: same name, same bytes.
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: filename,
          Body: image.bytes,
          ContentType: imageContentType(filename) ?? "application/octet-stream",
          CacheControl: CACHE_CONTROL,
        }),
      );
      return filename;
    },

    async has(filename) {
      if (imageContentType(filename) === null) return false;
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: filename }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    async open(filename) {
      const contentType = imageContentType(filename);
      if (contentType === null) return null;

      let response;
      try {
        response = await client.send(
          new GetObjectCommand({ Bucket: config.bucket, Key: filename }),
        );
      } catch (error) {
        // Banked but not in the bucket — a wiped store next to a kept
        // database, or a round banked before the migration. A 404, like a name
        // we never issued. Anything else is the store failing, and saying
        // "not found" about an unreachable bucket sends the operator hunting
        // for a missing picture that is right where it should be.
        if (isNotFound(error)) return null;
        throw error;
      }

      if (!response.Body) return null;
      return {
        contentType: response.ContentType ?? contentType,
        contentLength: response.ContentLength ?? null,
        body: response.Body as Readable,
      };
    },
  };
}

const isNotFound = (error: unknown): boolean => {
  const named = (error as { name?: string })?.name;
  if (named === "NoSuchKey" || named === "NotFound") return true;
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
};

/**
 * The bucket, read out of the environment — by the game server, by the fill
 * tool and by the migration script, all through this one function, because
 * three processes disagreeing about which bucket the pictures are in is the
 * failure this is here to make impossible.
 *
 * Everything is required except the region, which is a formality for a store
 * that has only one: Garage answers to whatever `s3_region` its config names,
 * and the Coolify template names it "garage".
 */
export function readS3Config(env: NodeJS.ProcessEnv, who: string): S3ImageStoreConfig {
  const required = (key: string): string => {
    const value = (env[key] ?? "").trim();
    if (!value) {
      throw new Error(
        `${key} is required — the bank's images live in an S3 bucket now, not on disk. Copy the ${who} .env.example and set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.`,
      );
    }
    return value;
  };

  const endpoint = required("S3_ENDPOINT").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error(
      `S3_ENDPOINT must be an origin like https://s3.example.com, got ${JSON.stringify(env.S3_ENDPOINT)}`,
    );
  }

  return {
    endpoint,
    region: (env.S3_REGION ?? "").trim() || "garage",
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  };
}
