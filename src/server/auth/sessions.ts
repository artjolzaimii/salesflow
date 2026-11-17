import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/server/db";

/** Absolute session lifetime, enforced on the server whatever the cookie says. */
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

/**
 * Server-side session registry (table auth_sessions). The Auth.js JWT carries
 * the session id (`sid`); load-principal.ts requires a matching, unrevoked,
 * unexpired row on every request. That makes sign-out and deactivation revoke
 * access immediately, even for a copied cookie, and means a token minted with
 * AUTH_SECRET alone (no row) is refused.
 */
export async function createSession(userId: string, meta: { userAgent?: string | null; ipAddress?: string | null } = {}): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  await db.authSession.create({
    data: { id, userId, createdAt: new Date(now), expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000), userAgent: meta.userAgent ?? null, ipAddress: meta.ipAddress ?? null },
  });
  // Housekeeping: drop this user's long-dead rows so the table stays small.
  await db.authSession.deleteMany({ where: { userId, expiresAt: { lt: new Date(now - 7 * 24 * 3600 * 1000) } } });
  return id;
}

export async function revokeSession(id: string): Promise<void> {
  await getDb().authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["$transaction"]>[0]>[0];

/** Ends every live session of a user (deactivation, role change, password reset), optionally keeping one. */
export async function revokeUserSessions(userId: string, opts: { except?: string; tx?: Tx } = {}): Promise<number> {
  const db = opts.tx ?? getDb();
  const res = await db.authSession.updateMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, ...(opts.except ? { id: { not: opts.except } } : {}) },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
