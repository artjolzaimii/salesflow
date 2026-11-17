import { encode } from "next-auth/jwt";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_PASSWORD, TEST_AUTH_SECRET } from "../support/env";
import { db, invoicedOrder, key, MANAGER, NIPT, REP_KORCE, REP_TIRANA } from "../support/fixtures";

/**
 * End-to-end against `next start` on the test database (see global-setup).
 * Requires a production build (`npm run build`); skipped otherwise.
 */
const base = inject("baseUrl");
const COOKIE = "authjs.session-token";

/** Signs in through the real Auth.js credentials endpoint; returns the session cookie or null. */
async function signIn(email: string, password: string): Promise<string | null> {
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

const get = (path: string, cookie?: string) => fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: "manual" });
const post = (path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });

/** A session cookie minted with the server's secret (to test expiry and forgery). */
async function mintCookie(email: string, maxAge: number) {
  const u = await db().user.findUniqueOrThrow({ where: { email } });
  const token = await encode({ token: { sub: u.id, email }, secret: TEST_AUTH_SECRET, salt: COOKIE, maxAge });
  return `${COOKIE}=${token}`;
}

describe.skipIf(!base)("authentication over HTTP", () => {
  let manager: string;
  let rep: string;

  beforeAll(async () => {
    manager = (await signIn(MANAGER, DEMO_PASSWORD))!;
    rep = (await signIn(REP_TIRANA, DEMO_PASSWORD))!;
  });
  afterAll(async () => {
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: true } });
  });

  it("signs in with valid credentials and returns the user and role", async () => {
    expect(manager).toMatch(new RegExp(`^${COOKIE}=`));
    const res = await get("/api/me", manager);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ email: MANAGER, role: "SALES_MANAGER", name: "Elira Kola" });
    expect(body.permissions).toContain("payments.record");
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("sets an httpOnly, SameSite=Lax session cookie", async () => {
    const csrf = await fetch(`${base}/api/auth/csrf`);
    const { csrfToken } = await csrf.json();
    const res = await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrf.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") },
      body: new URLSearchParams({ email: MANAGER, password: DEMO_PASSWORD, csrfToken }),
    });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(COOKIE))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("rejects invalid credentials without issuing a session", async () => {
    expect(await signIn(MANAGER, "WrongPassword-1")).toBeNull();
    expect(await signIn("nobody@salesflow.test", DEMO_PASSWORD)).toBeNull();
  });

  it("rejects a disabled account at sign-in and ends its existing session", async () => {
    const cookie = (await signIn(REP_KORCE, DEMO_PASSWORD))!;
    expect((await get("/api/me", cookie)).status).toBe(200);
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: false } });
    expect(await signIn(REP_KORCE, DEMO_PASSWORD)).toBeNull();
    expect((await get("/api/me", cookie)).status).toBe(401); // same cookie, next request
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: true } });
  });

  it("rejects an expired session and a forged one", async () => {
    const valid = await mintCookie(MANAGER, 60);
    expect((await get("/api/me", valid)).status).toBe(200); // control: minting works
    // Auth.js allows 15 s of clock skew when checking `exp`; this one expired 2 minutes ago.
    const expired = await mintCookie(MANAGER, -120);
    expect((await get("/api/me", expired)).status).toBe(401);
    expect((await get("/api/me", await mintCookie(MANAGER, -20))).status).toBe(401); // just past the skew window
    const tampered = valid.slice(0, -6) + (valid.endsWith("AAAAAA") ? "BBBBBB" : "AAAAAA");
    expect((await get("/api/me", tampered)).status).toBe(401);
    const otherSecret = await encode({ token: { sub: "x" }, secret: "a-different-secret-0123456789abcdef", salt: COOKIE, maxAge: 60 });
    expect((await get("/api/me", `${COOKIE}=${otherSecret}`)).status).toBe(401);
  });

  it("signs out: the session cookie is cleared", async () => {
    const cookie = (await signIn(MANAGER, DEMO_PASSWORD))!;
    const csrf = await fetch(`${base}/api/auth/csrf`, { headers: { cookie } });
    const { csrfToken } = await csrf.json();
    const csrfCookie = csrf.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const res = await fetch(`${base}/api/auth/signout`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${cookie}; ${csrfCookie}` },
      body: new URLSearchParams({ csrfToken }),
    });
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(COOKIE + "="));
    expect(cleared).toMatch(new RegExp(`^${COOKIE}=;|Max-Age=0|Expires=Thu, 01 Jan 1970`, "i"));
  });

  it("has no self-registration endpoint", async () => {
    for (const path of ["/api/auth/signup", "/api/auth/register", "/api/users", "/register", "/signup"]) {
      const res = await post(path, { email: "x@y.z", password: "longenough1" });
      expect([400, 401, 404, 405, 307]).toContain(res.status); // 400: Auth.js "unknown action"
      expect(res.status).not.toBe(200);
    }
  });

  describe("unauthorized API access", () => {
    it("answers 401 JSON without a session", async () => {
      for (const path of ["/api/me", "/api/customers"]) {
        const res = await get(path);
        expect(res.status).toBe(401);
        expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
      }
      const { order, invoice } = await invoicedOrder({ nipt: NIPT.marketAlba });
      expect((await get(`/api/orders/${order.id}`)).status).toBe(401);
      expect((await post("/api/payments", { invoiceId: invoice.id, amount: "1", paymentDate: "2026-11-10", method: "CASH", idempotencyKey: key() })).status).toBe(401);
      expect((await post(`/api/invoices/${invoice.id}/cancel`, { reason: "nope" })).status).toBe(401);
    });

    it("answers 403 when the role lacks the permission", async () => {
      const { invoice } = await invoicedOrder({ nipt: NIPT.marketAlba }); // rep.tirana's own customer
      const pay = await post("/api/payments", { invoiceId: invoice.id, amount: "1", paymentDate: "2026-11-10", method: "CASH", idempotencyKey: key() }, rep);
      expect(pay.status).toBe(403);
      expect((await pay.json()).error.code).toBe("FORBIDDEN");
      expect((await post(`/api/invoices/${invoice.id}/cancel`, { reason: "nope" }, rep)).status).toBe(403);
      expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it("answers 404 for records outside a rep's scope, 200 for their own", async () => {
      const own = await invoicedOrder({ nipt: NIPT.marketAlba });
      const foreign = await invoicedOrder({ nipt: NIPT.liqeni });
      expect((await get(`/api/orders/${own.order.id}`, rep)).status).toBe(200);
      expect((await get(`/api/orders/${foreign.order.id}`, rep)).status).toBe(404);
      expect((await get(`/api/orders/${foreign.order.id}`, manager)).status).toBe(200);
      const customers = (await (await get("/api/customers", rep)).json()).items as { nipt: string }[];
      const nipts = customers.map((c) => c.nipt);
      expect(nipts).toEqual(expect.arrayContaining(["L12345678A", "L23456789B", "L56789012E"]));
      expect(nipts).not.toContain(NIPT.liqeni); // rep.korce's customers never appear
      expect(nipts).not.toContain(NIPT.hotelKorca);
    });

    it("refuses cross-origin and non-JSON writes (CSRF defence)", async () => {
      const { order } = await invoicedOrder({ nipt: NIPT.marketAlba });
      expect((await post(`/api/orders/${order.id}/status`, { status: "PROCESSING" }, manager, { origin: "https://evil.example" })).status).toBe(403);
      const form = await fetch(`${base}/api/orders/${order.id}/status`, { method: "POST", headers: { cookie: manager, "content-type": "application/x-www-form-urlencoded" }, body: "status=PROCESSING" });
      expect(form.status).toBe(415);
      expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CONFIRMED");
    });
  });

  describe("business-rule endpoints", () => {
    it("progresses an invoiced order and reports invalid transitions as 409", async () => {
      const { order } = await invoicedOrder({ nipt: NIPT.marketAlba });
      const ok = await post(`/api/orders/${order.id}/status`, { status: "PROCESSING" }, rep);
      expect(ok.status).toBe(200);
      const bad = await post(`/api/orders/${order.id}/status`, { status: "CONFIRMED" }, manager);
      expect(bad.status).toBe(409);
      expect((await bad.json()).error.code).toBe("INVALID_STATUS_TRANSITION");
      const detail = await (await get(`/api/orders/${order.id}`, manager)).json();
      expect(detail.order).toMatchObject({ status: "PROCESSING", invoiced: true });
    });

    it("rejects sub-cent payment amounts with 422 and records nothing", async () => {
      const { invoice } = await invoicedOrder({ nipt: NIPT.marketAlba });
      const res = await post("/api/payments", { invoiceId: invoice.id, amount: "10.005", paymentDate: "2026-11-10", method: "CASH", idempotencyKey: key() }, manager);
      expect(res.status).toBe(422);
      expect(JSON.stringify(await res.json())).toContain("at most two decimal places");
      expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it("records a payment once per idempotency key (201, then 200 replay)", async () => {
      const { invoice } = await invoicedOrder({ nipt: NIPT.marketAlba });
      const body = { invoiceId: invoice.id, amount: "12.34", paymentDate: "2026-11-10", method: "CASH", idempotencyKey: key() };
      const first = await post("/api/payments", body, manager);
      const second = await post("/api/payments", body, manager);
      expect([first.status, second.status]).toEqual([201, 200]);
      expect((await second.json()).replayed).toBe(true);
      expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
    });

    it("cancels an invoice and issues its replacement", async () => {
      const { invoice } = await invoicedOrder({ nipt: NIPT.marketAlba });
      expect((await post(`/api/invoices/${invoice.id}/replacement`, { issueDate: "2026-11-05", dueDate: "2026-12-05" }, manager)).status).toBe(409);
      expect((await post(`/api/invoices/${invoice.id}/cancel`, { reason: "Wrong due date" }, manager)).status).toBe(200);
      const repl = await post(`/api/invoices/${invoice.id}/replacement`, { issueDate: "2026-11-05", dueDate: "2026-12-05" }, manager);
      expect(repl.status).toBe(201);
      expect((await repl.json()).invoice.invoiceNumber).toBe(invoice.invoiceNumber + "-R1");
    });
  });

  describe("protected pages", () => {
    it("redirects to /login without a session cookie", async () => {
      for (const path of ["/dashboard", "/orders", "/users"]) {
        const res = await get(path);
        expect(res.status).toBe(307);
        expect(res.headers.get("location")).toMatch(/\/login$/);
      }
      expect((await get("/login")).status).toBe(200);
    });

    it("server-side gate sends a rep away from admin pages", async () => {
      const res = await get("/users", rep);
      const html = await res.text();
      // The gate runs inside the streamed layout, so the redirect is delivered in the stream.
      expect(html).toContain("/dashboard");
      expect(html).not.toContain("Administration screens");
      // Control: an admin gets the page content.
      const admin = (await signIn("admin@salesflow.test", DEMO_PASSWORD))!;
      expect(await (await get("/users", admin)).text()).toContain("Administration screens");
    });
  });
});
