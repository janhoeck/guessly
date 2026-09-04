import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * The door. Every request but the login page's own is checked for a signed
 * session before it reaches a page, a picture or an action.
 *
 * A page you are not signed in for sends you to sign in and then back to
 * where you were going. Anything else — a picture, a form post — is refused
 * outright, because a redirect is not an answer an `<img>` or a server action
 * can act on, and a 401 says what happened.
 *
 * The password itself is read from the environment here rather than through
 * `lib/config`, which would pull the bank's configuration — and a `node:`
 * import — into a file that runs before any of that is wanted.
 */
export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const secret = (process.env.ADMIN_PASSWORD ?? "").trim();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (secret !== "" && token !== undefined && (await verifySession(token, secret, Date.now()))) {
    return NextResponse.next();
  }

  if (request.method === "GET" && !pathname.startsWith("/img/")) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return new NextResponse("Sign in first.", { status: 401 });
}

export const config = {
  /** Everything but Next's own assets and the favicon. */
  matcher: ["/((?!_next/|favicon\\.ico$).*)"],
};
