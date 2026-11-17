import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/server/db";

/**
 * Failed-attempt throttle in the database (auth_login_throttle), shared by all
 * server instances. Keys are SHA-256 of "<kind>:<subject>", so no address or
 * id is stored. Each kind has its own limit:
 * - "email": sign-in and re-authentication passwords, 10 failures / 15 min.
 * - "mfa":   MFA codes per user (sign-in and account changes), 5 failures / 15 min.
 */
export const THROTTLES = {
  email: { max: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
  mfa: { max: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 },
} as const;
export type ThrottleKind = keyof typeof THROTTLES;

export const throttleKey = (kind: ThrottleKind, subject: string) => createHash("sha256").update(`${kind === "email" ? "email" : kind}:${subject}`).digest("hex");

export async function isThrottled(kind: ThrottleKind, subject: string): Promise<boolean> {
  const row = await getDb().authLoginThrottle.findUnique({ where: { key: throttleKey(kind, subject) }, select: { lockedUntil: true } });
  return !!row?.lockedUntil && row.lockedUntil > new Date();
}

export async function recordThrottleFailure(kind: ThrottleKind, subject: string): Promise<void> {
  const { max, windowMs, lockMs } = THROTTLES[kind];
  const db = getDb();
  const key = throttleKey(kind, subject);
  const windowStart = new Date(Date.now() - windowMs);
  const lockUntil = new Date(Date.now() + lockMs);
  // One atomic upsert: concurrent failures from several instances can't undercount.
  await db.$executeRaw`
    INSERT INTO auth_login_throttle AS t (key, failures, window_started_at, locked_until)
    VALUES (${key}, 1, now(), NULL)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN t.window_started_at < ${windowStart} THEN 1 ELSE t.failures + 1 END,
      window_started_at = CASE WHEN t.window_started_at < ${windowStart} THEN now() ELSE t.window_started_at END,
      locked_until = CASE
        WHEN (CASE WHEN t.window_started_at < ${windowStart} THEN 1 ELSE t.failures + 1 END) >= ${max} THEN ${lockUntil}
        ELSE t.locked_until END`;
  await db.authLoginThrottle.deleteMany({
    where: { windowStartedAt: { lt: new Date(Date.now() - 24 * 3600_000) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
  });
}

export async function clearThrottle(kind: ThrottleKind, subject: string): Promise<void> {
  await getDb().authLoginThrottle.deleteMany({ where: { key: throttleKey(kind, subject) } });
}
