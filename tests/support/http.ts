import { inject } from "vitest";

export const base = inject("baseUrl");
export const COOKIE = "authjs.session-token";

/** Signs in through the real Auth.js credentials endpoint; returns the session cookie or null. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = csrfRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ email, password, csrfToken, callbackUrl: `${base}/dashboard` }),
  });
  const session = res.headers.getSetCookie().find((c) => c.startsWith(COOKIE + "="));
  return session ? session.split(";")[0] : null;
}

const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  fetch(base + path, {
    method,
    redirect: "manual",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  get: (path: string, cookie?: string) => send("GET", path, cookie),
  post: (path: string, body: unknown, cookie?: string) => send("POST", path, cookie, body),
  patch: (path: string, body: unknown, cookie?: string) => send("PATCH", path, cookie, body),
  del: (path: string, cookie?: string) => send("DELETE", path, cookie),
};
