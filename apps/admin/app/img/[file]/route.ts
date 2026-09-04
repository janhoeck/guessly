import { Readable } from "node:stream";
import { isSignedIn } from "@/lib/auth";
import { getBank } from "@/lib/bank";

/**
 * Banked pictures, from this app's own origin.
 *
 * The bucket is private and the admin has the credentials, so it reads the
 * object and streams it out — the same thing the game server does at the
 * same path, for the same reason: nothing but a process holding the key
 * ever talks to the bucket. The name is content-addressed and validated by
 * the store, so a made-up one is a 404 before the bucket is asked and a real
 * one can be cached for as long as the browser likes — a different picture
 * is a different name.
 *
 * `private` rather than `public` in the cache header, because the response
 * is behind a sign-in and a shared cache in front of the admin must not hand
 * it to the next person along.
 */
export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  // The proxy already refused an unsigned request; this is the second lock.
  if (!(await isSignedIn())) return new Response("Sign in first.", { status: 401 });

  const { file } = await context.params;
  const { images } = await getBank();

  let found;
  try {
    found = await images.open(file);
  } catch (error) {
    console.error(`[admin] image store failed for ${file}`, error);
    return new Response("Image store unavailable", { status: 502 });
  }
  if (found === null) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "content-type": found.contentType,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  if (found.contentLength !== null) headers.set("content-length", String(found.contentLength));

  return new Response(Readable.toWeb(found.body) as ReadableStream, { headers });
}
