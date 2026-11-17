import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { db, MANAGER } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/** Phase 6A security boundaries and regressions, against `next start` (production mode). */
describe.skipIf(!base)("security over HTTP", () => {
  let manager: string;
  beforeAll(async () => {
    manager = (await signIn(MANAGER, DEMO_PASSWORD))!;
  });

  it("sends security headers on pages and API responses, and no X-Powered-By", async () => {
    for (const path of ["/login", "/api/health", "/api/me"]) {
      const res = await fetch(base + path, { redirect: "manual" });
      const h = res.headers;
      expect(h.get("x-powered-by"), path).toBeNull();
      expect(h.get("x-content-type-options"), path).toBe("nosniff");
      expect(h.get("x-frame-options"), path).toBe("DENY");
      expect(h.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
      expect(h.get("strict-transport-security"), path).toMatch(/max-age=\d+/);
      const csp = h.get("content-security-policy") ?? "";
      for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp, path).toContain(directive);
      expect(csp, path).not.toContain("unsafe-eval"); // production build
      expect(h.get("access-control-allow-origin"), path).toBeNull(); // same-origin API, no CORS
    }
  });

  it("exposes a health check that reveals nothing", async () => {
    const res = await fetch(base + "/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("caps request bodies and refuses browser cross-site writes", async () => {
    const big = { name: "x".repeat(300 * 1024) };
    const res = await api.post("/api/categories", big, manager);
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    const cross = await fetch(base + "/api/categories", {
      method: "POST",
      headers: { cookie: manager, "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ name: "Cross-site " + Date.now() }),
    });
    expect(cross.status).toBe(403);
    const bad = await fetch(base + "/api/categories", { method: "POST", headers: { cookie: manager, "content-type": "application/json" }, body: "{not json" });
    expect(bad.status).toBe(400);
  });

  it("returns errors without internal details", async () => {
    const res = await api.get("/api/orders?sort=__proto__&page=-1", manager);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toMatch(/prisma|stack|at \w+ \(|node_modules|postgres|SELECT /i);
    const missing = await api.get(`/api/invoices/${crypto.randomUUID()}`, manager);
    expect(await missing.json()).toEqual({ error: { code: "NOT_FOUND", message: "Invoice not found." } });
  });

  it("throttles repeated failed sign-ins across instances (database), storing no address", async () => {
    const email = `throttle.${Date.now()}@salesflow.test`;
    const password = "Correct-Password-123";
    await db().user.create({ data: { email, role: "SALES_REPRESENTATIVE", passwordHash: await hash(password, 10) } });
    for (let i = 0; i < 10; i++) expect(await signIn(email, "wrong-password-" + i)).toBeNull();
    expect(await signIn(email, password)).toBeNull(); // locked: even the right password is refused
    const key = createHash("sha256").update("email:" + email).digest("hex");
    const row = await db().authLoginThrottle.findUniqueOrThrow({ where: { key } });
    expect(row.failures).toBeGreaterThanOrEqual(10);
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(await db().authLoginThrottle.findMany())).not.toContain(email);
    await db().authLoginThrottle.delete({ where: { key } });
    expect(await signIn(email, password)).not.toBeNull();
    expect(await db().authLoginThrottle.count({ where: { key } })).toBe(0); // success clears the counter
  });

  it("issues a server-side session per sign-in", async () => {
    const before = await db().authSession.count();
    const cookie = await signIn(MANAGER, DEMO_PASSWORD);
    expect(cookie).not.toBeNull();
    expect(await db().authSession.count()).toBe(before + 1);
    const res = await fetch(base + "/api/me", { headers: { cookie: cookie! } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/passwordHash|sessionId|"sid"/);
  });
});
