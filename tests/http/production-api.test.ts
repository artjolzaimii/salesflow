import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { ADMIN, MANAGER, db } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/**
 * Phase 6C rate limits and operations endpoints over HTTP. The test server trusts
 * the header x-test-client-ip as the client IP (CLIENT_IP_HEADER), so each test
 * uses its own made-up address.
 */
describe.skipIf(!base)("production limits and operations over HTTP", () => {
  let admin: string;
  const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}-${crypto.randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    admin = (await signIn(ADMIN, DEMO_PASSWORD))!;
  });

  async function attemptSignIn(clientIp: string, email = `nobody.${crypto.randomUUID()}@salesflow.test`, password = "wrong-password-123") {
    const csrf = await fetch(`${base}/api/auth/csrf`);
    const { csrfToken } = await csrf.json();
    return fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrf.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), "x-test-client-ip": clientIp },
      body: new URLSearchParams({ email, password, csrfToken }),
    });
  }
  const signinBucket = (clientIp: string) => createHash("sha256").update(`signin:${clientIp}`).digest("hex");

  it("limits failed sign-ins per client IP across accounts", async () => {
    const attacker = ip();
    for (let i = 0; i < 30; i++) expect((await attemptSignIn(attacker)).status).not.toBe(429);
    const blocked = await attemptSignIn(attacker);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // Even the right password is refused from that network until the window ends.
    expect((await attemptSignIn(attacker, MANAGER, DEMO_PASSWORD)).status).toBe(429);
    expect((await attemptSignIn(ip())).status).not.toBe(429); // another network is unaffected
  });

  it("never counts successful sign-ins, so a shared office address isn't blocked", async () => {
    const office = ip();
    for (let i = 0; i < 3; i++) {
      const r = await attemptSignIn(office, MANAGER, DEMO_PASSWORD);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).not.toContain("error=");
    }
    expect(await db().rateLimitCounter.count({ where: { bucketKey: signinBucket(office) } })).toBe(0);
    await attemptSignIn(office); // one failure is counted
    expect((await db().rateLimitCounter.findFirst({ where: { bucketKey: signinBucket(office) } }))?.count).toBe(1);
  });

  it("limits password-reset submissions per client IP", async () => {
    const client = ip();
    const post = () =>
      fetch(`${base}/api/password-reset`, { method: "POST", headers: { "content-type": "application/json", "x-test-client-ip": client }, body: JSON.stringify({ token: "x".repeat(43), newPassword: "Some-Long-Password-1" }) });
    for (let i = 0; i < 10; i++) expect((await post()).status).toBe(410);
    const r = await post();
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("RATE_LIMITED");
  });

  it("limits financial writes per session, without affecting reads or other sessions", async () => {
    const session = (await signIn(MANAGER, DEMO_PASSWORD))!;
    const bad = { invoiceId: crypto.randomUUID() }; // invalid: 422, but it still counts as a write attempt
    for (let i = 0; i < 60; i++) expect((await api.post("/api/payments", bad, session)).status).toBe(422);
    const limited = await api.post("/api/payments", bad, session);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await api.get("/api/payments?pageSize=1", session)).status).toBe(200);
    const other = (await signIn(MANAGER, DEMO_PASSWORD))!;
    expect((await api.post("/api/payments", bad, other)).status).toBe(422);
  });

  it("serves an administrator-only operations summary with counts, not secrets", async () => {
    const res = await api.get("/api/ops/summary", admin);
    expect(res.status).toBe(200);
    const { summary } = await res.json();
    expect(summary).toMatchObject({
      instance: { shuttingDown: false },
      database: { migrations: { failed: 0 }, latencyMs: expect.any(Number) },
      auth: { activeSessions: expect.any(Number) },
      assistant: { estimatedSpendUsdLast24h: expect.any(Number) },
    });
    expect(summary.database.migrations.applied).toBe(10);
    expect(JSON.stringify(summary)).not.toMatch(/@salesflow|password|secret|token|sk-ant/i);
    expect((await api.get("/api/ops/summary", (await signIn(MANAGER, DEMO_PASSWORD))!)).status).toBe(403);
    expect((await api.get("/api/ops/summary")).status).toBe(401);
  });

  it("health reports ready", async () => {
    const r = await fetch(`${base}/api/health`);
    expect([r.status, await r.json()]).toEqual([200, { status: "ok" }]);
  });
});
