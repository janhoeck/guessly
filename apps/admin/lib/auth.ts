import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminPassword } from "@/lib/config";
import { SESSION_COOKIE, SESSION_TTL_MS, issueSession, verifySession } from "@/lib/session";

/**
 * The session cookie, from the server's side of a request.
 *
 * `proxy.ts` already checks it at the door for every request. The checks
 * here are the second lock: a server action is a write, and a write that
 * trusted the door alone would be one misconfigured matcher away from open.
 */

export async function isSignedIn(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined) return false;
  const secret = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (secret === "") return false;
  return verifySession(token, secret, Date.now());
}

/** For anything that changes the bank: signed in, or sent to sign in. */
export async function requireAdmin(): Promise<void> {
  if (!(await isSignedIn())) redirect("/login");
}

export async function signIn(): Promise<void> {
  const token = await issueSession(adminPassword(), Date.now());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
