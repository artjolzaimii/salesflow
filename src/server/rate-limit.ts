import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { logEvent } from "@/server/log";

/**
 * Shared rate limits (table rate_limit_counters), so they hold across every
 * application instance. Fixed windows: one atomic upsert per check. Subjects
 * (session cookies, client IPs) are hashed together with the limit name.
 *
 * Per-email sign-in and per-user MFA throttles live in auth/throttle.ts; the
 * assistant's per-user limits in services/assistant.ts. These limits add:
 * - signin:        FAILED sign-ins per client IP (checked with isLimited, counted
 *                  with consume on failure), so an office behind one address is
 *                  never blocked by its own successful sign-ins
 * - password-reset: setup/reset link submissions per client IP
 * - write:         API writes (POST/PATCH/DELETE) per session
 * - financial:     order, invoice and payment writes per session
 * General read traffic is best limited at the hosting layer (docs/deployment.md).
 */
const envInt = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export const LIMITS = {
  signin: () => ({ max: envInt("RATE_LIMIT_SIGNIN_FAILURES_PER_IP", 30), windowSec: 15 * 60 }),
  "password-reset": () => ({ max: envInt("RATE_LIMIT_PASSWORD_RESET_PER_IP", 10), windowSec: 60 * 60 }),
  write: () => ({ max: envInt("RATE_LIMIT_WRITES_PER_MINUTE", 120), windowSec: 60 }),
  financial: () => ({ max: envInt("RATE_LIMIT_FINANCIAL_WRITES_PER_MINUTE", 60), windowSec: 60 }),
} as const;
export type LimitName = keyof typeof LIMITS;

export interface LimitResult {
  ok: boolean;
  count: number;
  max: number;
  retryAfterSec: number;
}

const bucketKey = (name: string, subject: string) => createHash("sha256").update(`${name}:${subject}`).digest("hex");

/** Counts one hit for `subject` under `name`; ok=false once the window's limit is exceeded. */
export async function consume(name: LimitName, subject: string, now = Date.now()): Promise<LimitResult> {
  const { max, windowSec } = LIMITS[name]();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const db = getDb();
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limit_counters AS r (bucket_key, window_start, count)
    VALUES (${bucketKey(name, subject)}, ${windowStart}, 1)
    ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = r.count + 1
    RETURNING count`;
  // Housekeeping (about 1 in 50 calls): windows older than a day are dropped (indexed).
  if (Math.random() < 0.02) await db.rateLimitCounter.deleteMany({ where: { windowStart: { lt: new Date(now - 24 * 3600_000) } } });
  const count = Number(row.count);
  return { ok: count <= max, count, max, retryAfterSec: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000)) };
}

/** True when `subject` has already used up the current window (reads only, counts nothing). */
export async function isLimited(name: LimitName, subject: string, now = Date.now()): Promise<LimitResult> {
  const { max, windowSec } = LIMITS[name]();
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const row = await getDb().rateLimitCounter.findUnique({
    where: { bucketKey_windowStart: { bucketKey: bucketKey(name, subject), windowStart } },
    select: { count: true },
  });
  const count = row?.count ?? 0;
  return { ok: count < max, count, max, retryAfterSec: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000)) };
}

/** consume() that throws 429 RATE_LIMITED (with Retry-After) when the limit is exceeded. */
export async function enforce(name: LimitName, subject: string): Promise<void> {
  const r = await consume(name, subject);
  if (!r.ok) {
    logEvent("rate_limited", { limit: name });
    throw new AppError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.", { retryAfterSec: r.retryAfterSec });
  }
}

/**
 * The client IP as reported by the trusted proxy in front of the app, read from
 * the header named in CLIENT_IP_HEADER (e.g. "x-real-ip", "cf-connecting-ip",
 * or "x-forwarded-for", whose last entry is the one the proxy added). Without
 * that setting there is no trustworthy IP and IP-based limits are skipped:
 * a client could otherwise spoof the header and pick its own bucket.
 */
export function clientIp(headers: Headers): string | null {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return null;
  const raw = headers.get(name);
  if (!raw) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = name === "x-forwarded-for" ? parts[parts.length - 1] : parts[0];
  return ip ? ip.slice(0, 64) : null;
}

/** Stable, non-reversible id for a session cookie value (the bucket subject for per-session limits). */
export const sessionSubject = (cookieValue: string) => createHash("sha256").update("session:" + cookieValue).digest("hex");
