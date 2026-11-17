import "server-only";
import { compare, hash } from "bcryptjs";
import { z } from "zod";
import { PASSWORD_MAX_LENGTH, passwordProblem } from "@/lib/password-policy";
import { audit } from "@/server/audit";
import { checkPassword, PASSWORD_HASH_COST } from "@/server/auth/credentials";
import { matchTotp, newMfaSecret, replaceRecoveryCodes, verifyMfa } from "@/server/auth/mfa";
import type { Principal } from "@/server/auth/principal";
import { mfaKeyAvailable } from "@/server/auth/secrets";
import { revokeUserSessions } from "@/server/auth/sessions";
import { getDb } from "@/server/db";
import { AppError, conflict, invalid, notFound } from "@/server/errors";

/**
 * Self-service account security for the signed-in user: password change, TOTP
 * MFA (setup, enable, disable, recovery codes) and their own sessions.
 * Sensitive changes require re-authentication with the current password, and
 * also an MFA code when MFA is on. Password checks share the sign-in throttle.
 */

const password = z.string().min(1, "Enter your current password.").max(PASSWORD_MAX_LENGTH);
const code = z.string().trim().min(6, "Enter the 6-digit code or a recovery code.").max(40);

export const changePasswordSchema = z.strictObject({ currentPassword: password, newPassword: z.string().max(PASSWORD_MAX_LENGTH), code: code.optional() });
export const reauthSchema = z.strictObject({ currentPassword: password, code: code.optional() });
export const enableMfaSchema = z.strictObject({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your app.") });

/* ------------------------------------------------------------ helpers */

const wrongPassword = () => new AppError(403, "REAUTH_FAILED", "The current password is incorrect.", { currentPassword: ["The current password is incorrect."] });

/** Re-authentication for sensitive changes: current password, plus an MFA code when MFA is on. */
async function reauthenticate(p: Principal, input: { currentPassword: string; code?: string }) {
  const user = await checkPassword(p.email, input.currentPassword);
  if (!user || user.id !== p.userId) throw wrongPassword();
  if (user.mfaEnabled) {
    if (!input.code) throw new AppError(403, "MFA_REQUIRED", "Enter a code from your authenticator app or a recovery code.", { code: ["Enter a code."] });
    const check = await verifyMfa(p.userId, input.code);
    if (!check.ok) {
      throw new AppError(403, check.reason === "locked" ? "MFA_LOCKED" : "MFA_INVALID", check.reason === "locked" ? "Too many wrong codes. Try again in 15 minutes." : "That code isn't valid.", {
        code: ["That code isn't valid."],
      });
    }
    if (check.method === "recovery") await audit(getDb(), { type: "RECOVERY_CODE_USED", actorUserId: p.userId, targetUserId: p.userId, details: { context: "re-authentication" } });
  }
  return user;
}

async function names(userId: string) {
  const e = await getDb().employee.findUnique({ where: { userId }, select: { firstName: true, lastName: true } });
  return e ? [e.firstName, e.lastName] : [];
}

/* ------------------------------------------------------------ profile */

export async function getAccount(p: Principal) {
  const u = await getDb().user.findUnique({
    where: { id: p.userId },
    select: {
      email: true,
      role: true,
      mfaEnabled: true,
      mfaEnabledAt: true,
      mfaPendingSecret: true,
      passwordChangedAt: true,
      mustChangePassword: true,
      createdAt: true,
      _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
    },
  });
  if (!u) throw notFound("Account");
  return {
    email: u.email,
    role: u.role,
    name: p.name,
    mfa: { enabled: u.mfaEnabled, enabledAt: u.mfaEnabledAt, setupPending: !u.mfaEnabled && !!u.mfaPendingSecret, recoveryCodesLeft: u._count.recoveryCodes, available: mfaKeyAvailable() },
    passwordChangedAt: u.passwordChangedAt,
    mustChangePassword: u.mustChangePassword,
    createdAt: u.createdAt,
  };
}

/* ------------------------------------------------------------ password */

/**
 * Changes the caller's password: current password (and MFA code if enabled),
 * policy check, no reuse of the current password. All other sessions are
 * revoked; the current one is kept, because this request just proved the
 * password (and MFA) again, so signing it out would add no protection.
 */
export async function changePassword(p: Principal, raw: z.output<typeof changePasswordSchema>) {
  await reauthenticate(p, raw);
  const problem = passwordProblem(raw.newPassword, { email: p.email, names: await names(p.userId) });
  if (problem) throw invalid(problem, { newPassword: [problem] });
  const db = getDb();
  const current = await db.user.findUniqueOrThrow({ where: { id: p.userId }, select: { passwordHash: true } });
  if (await compare(raw.newPassword, current.passwordHash)) {
    throw invalid("Choose a password different from the current one.", { newPassword: ["Choose a password different from the current one."] });
  }
  const passwordHash = await hash(raw.newPassword, PASSWORD_HASH_COST);
  const revoked = await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: p.userId }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } });
    await tx.passwordResetToken.updateMany({ where: { userId: p.userId, usedAt: null }, data: { usedAt: new Date() } });
    const n = await revokeUserSessions(p.userId, { except: p.sessionId, tx });
    await audit(tx, { type: "PASSWORD_CHANGED", actorUserId: p.userId, targetUserId: p.userId, details: { otherSessionsRevoked: n } });
    return n;
  });
  return { changed: true, otherSessionsRevoked: revoked };
}

/* ------------------------------------------------------------ MFA */

/** Starts MFA setup: a new secret, shown once for the authenticator app; inactive until verified. */
export async function startMfaSetup(p: Principal, raw: z.output<typeof reauthSchema>) {
  if (!mfaKeyAvailable()) throw new AppError(503, "MFA_NOT_CONFIGURED", "MFA isn't available: the server has no MFA encryption key.");
  const current = await getDb().user.findUniqueOrThrow({ where: { id: p.userId }, select: { mfaEnabled: true } });
  if (current.mfaEnabled) throw conflict("MFA_ALREADY_ENABLED", "MFA is already on. Turn it off first to set up a new device.");
  await reauthenticate(p, raw);
  const secret = newMfaSecret(p.email);
  await getDb().user.update({ where: { id: p.userId }, data: { mfaPendingSecret: secret.encrypted } });
  return { secret: secret.base32, otpauthUri: secret.uri, qrCode: secret.qrDataUrl };
}

/** Enables MFA after a valid code from the new secret; returns recovery codes (shown once). */
export async function enableMfa(p: Principal, raw: z.output<typeof enableMfaSchema>) {
  const db = getDb();
  const u = await db.user.findUniqueOrThrow({ where: { id: p.userId }, select: { mfaEnabled: true, mfaPendingSecret: true } });
  if (u.mfaEnabled) throw conflict("MFA_ALREADY_ENABLED", "MFA is already on.");
  if (!u.mfaPendingSecret) throw conflict("MFA_SETUP_NOT_STARTED", "Start MFA setup first.");
  const step = matchTotp(u.mfaPendingSecret, raw.code, null);
  if (step === null) throw invalid("That code doesn't match. Check the time on your phone and try again.", { code: ["That code doesn't match."] });
  return db.$transaction(async (tx) => {
    const done = await tx.user.updateMany({
      where: { id: p.userId, mfaEnabled: false, mfaPendingSecret: u.mfaPendingSecret },
      data: { mfaEnabled: true, mfaSecret: u.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastCounter: step },
    });
    if (done.count !== 1) throw conflict("MFA_ALREADY_ENABLED", "MFA setup changed in another session. Start again.");
    const codes = await replaceRecoveryCodes(tx, p.userId);
    const revoked = await revokeUserSessions(p.userId, { except: p.sessionId, tx });
    await audit(tx, { type: "MFA_ENABLED", actorUserId: p.userId, targetUserId: p.userId, details: { otherSessionsRevoked: revoked } });
    return { enabled: true, recoveryCodes: codes };
  });
}

/** Turns MFA off (password + current code or a recovery code). */
export async function disableMfa(p: Principal, raw: z.output<typeof reauthSchema>) {
  const user = await reauthenticate(p, raw);
  if (!user.mfaEnabled) throw conflict("MFA_NOT_ENABLED", "MFA is not on.");
  await getDb().$transaction(async (tx) => {
    await tx.user.update({ where: { id: p.userId }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastCounter: null } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: p.userId } });
    const revoked = await revokeUserSessions(p.userId, { except: p.sessionId, tx });
    await audit(tx, { type: "MFA_DISABLED", actorUserId: p.userId, targetUserId: p.userId, details: { otherSessionsRevoked: revoked } });
  });
  return { enabled: false };
}

/** New recovery codes (password + code); the old ones stop working. */
export async function regenerateRecoveryCodes(p: Principal, raw: z.output<typeof reauthSchema>) {
  const user = await reauthenticate(p, raw);
  if (!user.mfaEnabled) throw conflict("MFA_NOT_ENABLED", "MFA is not on.");
  return getDb().$transaction(async (tx) => {
    const codes = await replaceRecoveryCodes(tx, p.userId);
    await audit(tx, { type: "RECOVERY_CODES_REGENERATED", actorUserId: p.userId, targetUserId: p.userId });
    return { recoveryCodes: codes };
  });
}

/* ------------------------------------------------------------ sessions */

export async function listOwnSessions(p: Principal) {
  const rows = await getDb().authSession.findMany({
    where: { userId: p.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, userAgent: true, ipAddress: true },
  });
  return { items: rows.map((s) => ({ ...s, current: s.id === p.sessionId })) };
}

export async function revokeOwnSession(p: Principal, sessionId: string) {
  const db = getDb();
  const res = await db.authSession.updateMany({ where: { id: sessionId, userId: p.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (res.count !== 1) throw notFound("Session");
  await audit(db, { type: "SESSION_REVOKED", actorUserId: p.userId, targetUserId: p.userId, details: { current: sessionId === p.sessionId } });
  return { revoked: 1, current: sessionId === p.sessionId };
}

export async function revokeOtherSessions(p: Principal) {
  const db = getDb();
  const n = await revokeUserSessions(p.userId, { except: p.sessionId });
  await audit(db, { type: "SESSIONS_REVOKED", actorUserId: p.userId, targetUserId: p.userId, details: { revoked: n, keptCurrent: true } });
  return { revoked: n };
}
