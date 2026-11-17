import "server-only";
import { compare, hash } from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db";

/** bcrypt cost for new password hashes (seed and future user administration). */
export const PASSWORD_HASH_COST = 12;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  password: z.string().min(1).max(200),
});

export interface VerifiedUser {
  id: string;
  email: string;
}

// Compared against when the email is unknown, so the response time doesn't
// reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash(randomUUID(), PASSWORD_HASH_COST));

/* Failed-attempt throttle, in the database (auth_login_throttle) so every
   server instance shares it: 10 failures for one email within 15 minutes lock
   that email for 15 minutes. Keys are SHA-256 hashes, so attempted addresses are
   not stored. The lock applies to the right password too, and the response is
   the same as for a wrong one. */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const THROTTLE_MAX_FAILURES = 10;
export const THROTTLE_LOCK_MS = 15 * 60 * 1000;

const throttleKey = (email: string) => createHash("sha256").update("email:" + email).digest("hex");

async function isLocked(key: string): Promise<boolean> {
  const row = await getDb().authLoginThrottle.findUnique({ where: { key }, select: { lockedUntil: true } });
  return !!row?.lockedUntil && row.lockedUntil > new Date();
}

async function recordFailure(key: string): Promise<void> {
  const db = getDb();
  const windowStart = new Date(Date.now() - THROTTLE_WINDOW_MS);
  const lockUntil = new Date(Date.now() + THROTTLE_LOCK_MS);
  // One atomic upsert: concurrent failures from several instances can't undercount.
  await db.$executeRaw`
    INSERT INTO auth_login_throttle AS t (key, failures, window_started_at, locked_until)
    VALUES (${key}, 1, now(), NULL)
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN t.window_started_at < ${windowStart} THEN 1 ELSE t.failures + 1 END,
      window_started_at = CASE WHEN t.window_started_at < ${windowStart} THEN now() ELSE t.window_started_at END,
      locked_until = CASE
        WHEN (CASE WHEN t.window_started_at < ${windowStart} THEN 1 ELSE t.failures + 1 END) >= ${THROTTLE_MAX_FAILURES} THEN ${lockUntil}
        ELSE t.locked_until END`;
  // Housekeeping: rows idle for a day and not locked are dropped (indexed).
  await db.authLoginThrottle.deleteMany({
    where: { windowStartedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] },
  });
}

/** Clears the throttle (tests only). */
export async function resetLoginThrottle() {
  await getDb().authLoginThrottle.deleteMany({});
}

/**
 * Returns the user for a correct email/password pair, or null. Unknown email,
 * wrong password, a disabled user or a disabled employee record all give the
 * same null, so the login form can't be used to discover accounts.
 */
export async function verifyCredentials(raw: unknown): Promise<VerifiedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const key = throttleKey(email);
  if (await isLocked(key)) {
    await compare(password, await getDummyHash()); // same timing as a real check
    return null;
  }

  const user = await getDb().user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, isActive: true, employee: { select: { isActive: true } } },
  });
  const ok = await compare(password, user?.passwordHash ?? (await getDummyHash()));
  const enabled = !!user && user.isActive && (user.employee ? user.employee.isActive : true);

  if (!user || !ok || !enabled) {
    await recordFailure(key);
    return null;
  }
  await getDb().authLoginThrottle.deleteMany({ where: { key } });
  return { id: user.id, email: user.email };
}
