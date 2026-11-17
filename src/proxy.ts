import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: a request without an Auth.js session cookie is sent to
 * /login before any page renders. It does not validate the cookie; the (app)
 * layout and every Route Handler do that against the database (disabled users,
 * expired or forged tokens). API routes are excluded so they answer 401 JSON.
 */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function proxy(req: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => req.cookies.has(name));
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login page, API routes, Next internals and static files.
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)"],
};
