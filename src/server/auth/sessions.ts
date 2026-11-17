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
export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const id = randomUUID();
  const now = Date.now();
  await db.authSession.create({ data: { id, userId, createdAt: new Date(now), expiresAt: new Date(now + SESSION_MAX_AGE_SECONDS * 1000) } });
  // Housekeeping: drop this user's long-dead rows so the table stays small.
  await db.authSession.deleteMany({ where: { userId, expiresAt: { lt: new Date(now - 7 * 24 * 3600 * 1000) } } });
  return id;
}

export async function revokeSession(id: string): Promise<void> {
  await getDb().authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Ends every session of a user (deactivation, role change, password reset). */
export async function revokeUserSessions(userId: string): Promise<number> {
  const res = await getDb().authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return res.count;
}
