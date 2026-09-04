/**
 * The admin's sign-in, as a signed cookie.
 *
 * There is one password and no user table: whoever knows `ADMIN_PASSWORD` is
 * the operator. What the cookie carries is not the password but an expiry
 * stamped with an HMAC keyed off it — so a cookie proves the password was
 * typed once, lasts a week, cannot be forged without the secret, and every
 * one of them is voided by changing the secret. Stateless on purpose: the
 * admin keeps nothing in memory a second instance would have to share.
 *
 * Web Crypto rather than `node:crypto`, because the same two functions run
 * in `proxy.ts` — which stands at the door for every request — and in the
 * server actions behind it, and one implementation for both is the only way
 * they cannot disagree about what a valid session is.
 */

export const SESSION_COOKIE = "guessly_admin";

/** A week: long enough to be an operator, short enough that a lost laptop is not one forever. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/**
 * The signing key, derived from the secret rather than being it: a fixed
 * prefix so the key is not the raw bytes of the password, and a hash so its
 * length is whatever HMAC prefers rather than however long the password is.
 */
async function signingKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`guessly-admin:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array<ArrayBuffer> | null => {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

/** What is signed: the expiry, under a label so the MAC means one thing. */
const sessionMessage = (expiresAt: number): Uint8Array<ArrayBuffer> =>
  encoder.encode(`session:${expiresAt}`);

/** A fresh session token, valid for `SESSION_TTL_MS` from `now`. */
export async function issueSession(secret: string, now: number): Promise<string> {
  const expiresAt = now + SESSION_TTL_MS;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), sessionMessage(expiresAt));
  return `${expiresAt}.${toHex(signature)}`;
}

/** Is this a token `issueSession` made with this secret, and not yet expired? */
export async function verifySession(token: string, secret: string, now: number): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot === -1) return false;

  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;

  const signature = fromHex(token.slice(dot + 1));
  if (signature === null) return false;

  // `verify` compares in constant time, which a `===` on two hex strings
  // would not.
  return crypto.subtle.verify("HMAC", await signingKey(secret), signature, sessionMessage(expiresAt));
}

/**
 * Does the typed password match the configured one, without the comparison
 * saying how much of it did? Both go through the MAC and `verify` does the
 * comparing, so a wrong first letter and a wrong last letter take the same
 * time to refuse.
 */
export async function passwordMatches(given: string, expected: string): Promise<boolean> {
  const key = await signingKey(expected);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`password:${given}`));
  return crypto.subtle.verify("HMAC", key, mac, encoder.encode(`password:${expected}`));
}

/**
 * Where to go after signing in, if the login page was told. Only a path on
 * this site will do: a value that is an absolute URL, or the `//host` form a
 * browser reads as one, would make the login page a redirect anybody could
 * aim — so anything but a plain local path lands on the front page.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
