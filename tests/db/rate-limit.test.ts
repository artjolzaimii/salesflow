import { afterEach, describe, expect, it } from "vitest";
import { consume, isLimited } from "@/server/rate-limit";
import { db } from "../support/fixtures";

/** Shared rate limits in PostgreSQL (rate_limit_counters). */
describe("database rate limiter", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_PASSWORD_RESET_PER_IP;
  });

  it("allows up to the limit per window, then refuses with a retry time", async () => {
    process.env.RATE_LIMIT_PASSWORD_RESET_PER_IP = "3";
    const subject = "ip-" + crypto.randomUUID();
    const t = Date.UTC(2030, 0, 1, 10, 0, 5);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consume("password-reset", subject, t));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toMatchObject({ count: 4, max: 3 });
    expect(results[3].retryAfterSec).toBe(3600 - 5);
    // The next window starts fresh; other subjects and limits are independent.
    expect((await consume("password-reset", subject, t + 3600_000)).ok).toBe(true);
    expect((await consume("password-reset", "ip-" + crypto.randomUUID(), t)).ok).toBe(true);
    expect((await consume("signin", subject, t)).count).toBe(1);
  });

  it("checks without counting (failed-sign-in limit)", async () => {
    process.env.RATE_LIMIT_SIGNIN_FAILURES_PER_IP = "2";
    const subject = "office-" + crypto.randomUUID();
    const t = Date.UTC(2030, 0, 1, 12, 0, 0);
    for (let i = 0; i < 5; i++) expect((await isLimited("signin", subject, t)).ok).toBe(true);
    await consume("signin", subject, t);
    expect(await isLimited("signin", subject, t)).toMatchObject({ ok: true, count: 1 });
    await consume("signin", subject, t);
    expect(await isLimited("signin", subject, t)).toMatchObject({ ok: false, count: 2 });
    delete process.env.RATE_LIMIT_SIGNIN_FAILURES_PER_IP;
  });

  it("counts exactly under concurrency (works across instances)", async () => {
    const subject = "burst-" + crypto.randomUUID();
    const t = Date.UTC(2030, 0, 1, 11, 0, 0);
    const results = await Promise.all(Array.from({ length: 40 }, () => consume("write", subject, t)));
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it("stores hashed keys only", async () => {
    const subject = "203.0.113.77";
    await consume("signin", subject, Date.UTC(2030, 0, 2));
    const rows = await db().rateLimitCounter.findMany({ where: { windowStart: { gte: new Date(Date.UTC(2030, 0, 1)) } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(subject);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.bucketKey))).toBe(true);
  });
});
