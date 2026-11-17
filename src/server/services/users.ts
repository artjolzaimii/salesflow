import "server-only";
import { hash } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PASSWORD_MAX_LENGTH, passwordProblem } from "@/lib/password-policy";
import { USER_ROLES } from "@/lib/permissions";
import { email } from "@/lib/schemas/common";
import { AUDIT_EVENTS, audit } from "@/server/audit";
import { PASSWORD_HASH_COST } from "@/server/auth/credentials";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { hashToken, newToken } from "@/server/auth/secrets";
import { revokeUserSessions } from "@/server/auth/sessions";
import { clearThrottle } from "@/server/auth/throttle";
import { getDb } from "@/server/db";
import { AppError, conflict, invalid, mapDatabaseError, notFound } from "@/server/errors";
import { boolParam, listQuery, paged, skipTake } from "@/server/query";

/**
 * User administration (permission users.manage: administrators only).
 * - Accounts are created without a password: the administrator receives a
 *   one-time setup link (shown once, 72 h) and passes it to the person, who
 *   chooses their own password. Password resets work the same way (24 h).
 *   Links are stored as SHA-256 hashes; they are never logged or stored in clear.
 * - Role changes, deactivation, resets and MFA resets revoke the user's sessions.
 * - The last active administrator can't be demoted or deactivated, and
 *   administrators can't change their own role or status here.
 * - Every change is written to the security audit log.
 */

type Tx = Prisma.TransactionClient;

export const SETUP_LINK_HOURS = 72;
export const RESET_LINK_HOURS = 24;
/** pg_advisory_xact_lock key serializing role/status changes (last-administrator check). */
const ADMIN_LOCK = 0x5f0003;

export const userListQuery = listQuery(["email", "role", "createdAt"] as const, "email").extend({
  role: z.enum(USER_ROLES).optional(),
  active: boolParam.optional(),
  mfa: boolParam.optional(),
});
export const userCreateSchema = z.strictObject({ email, role: z.enum(USER_ROLES), employeeId: z.uuid().optional() });
export const userPatchSchema = z
  .strictObject({ role: z.enum(USER_ROLES), isActive: z.boolean(), employeeId: z.uuid().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");
export const auditListQuery = listQuery(["createdAt"] as const, "createdAt", "desc").extend({
  userId: z.uuid().optional(),
  type: z.enum(AUDIT_EVENTS).optional(),
});
export const resetCompletionSchema = z.strictObject({ token: z.string().trim().min(20).max(100), newPassword: z.string().max(PASSWORD_MAX_LENGTH) });

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  mfaEnabled: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  createdAt: true,
  employee: { select: { id: true, firstName: true, lastName: true, isActive: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const userDto = (u: UserRow) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  mfaEnabled: u.mfaEnabled,
  mustChangePassword: u.mustChangePassword,
  passwordChangedAt: u.passwordChangedAt,
  createdAt: u.createdAt,
  employee: u.employee ? { id: u.employee.id, name: `${u.employee.firstName} ${u.employee.lastName}`, isActive: u.employee.isActive } : null,
  /** Sign-in possible: the account and its employee record (if any) are active. */
  canSignIn: u.isActive && (u.employee ? u.employee.isActive : true),
});

/** The public origin for links: AUTH_URL when set (production), else the request origin. */
function linkFor(origin: string, token: string) {
  const base = (process.env.AUTH_URL || origin).replace(/\/+$/, "");
  // The token travels in the fragment, so it never reaches server logs or Referer headers.
  return `${base}/reset-password#token=${token}`;
}

async function issueLink(tx: Tx, userId: string, purpose: "SETUP" | "RESET", createdById: string, hours: number) {
  await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  const { token, hash: tokenHash } = newToken();
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await tx.passwordResetToken.create({ data: { id: randomUUID(), userId, tokenHash, purpose, createdById, expiresAt } });
  return { token, expiresAt };
}

/** Active administrators other than `exceptId` who can actually sign in. */
async function otherActiveAdmins(tx: Tx, exceptId: string) {
  return tx.user.count({ where: { id: { not: exceptId }, role: "ADMIN", isActive: true, OR: [{ employee: null }, { employee: { isActive: true } }] } });
}

/* --------------------------------------------------------------- reads */

export async function listUsers(p: Principal, q: z.output<typeof userListQuery> = userListQuery.parse({})) {
  assertPermission(p, "users.manage");
  const where: Prisma.UserWhereInput = {
    AND: [
      q.role ? { role: q.role } : {},
      q.active === undefined ? {} : { isActive: q.active },
      q.mfa === undefined ? {} : { mfaEnabled: q.mfa },
      q.q
        ? {
            OR: [
              { email: { contains: q.q, mode: "insensitive" } },
              { employee: { firstName: { contains: q.q, mode: "insensitive" } } },
              { employee: { lastName: { contains: q.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.user.findMany({ where, orderBy: [{ [q.sort]: q.dir }, { id: "asc" }], ...skipTake(q.page, q.pageSize), select: USER_SELECT }),
    db.user.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const sessions = await db.authSession.groupBy({
    by: ["userId"],
    where: { userId: { in: ids } },
    _max: { createdAt: true },
  });
  const live = await db.authSession.groupBy({ by: ["userId"], where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: new Date() } }, _count: { _all: true } });
  return paged(
    rows.map((u) => ({
      ...userDto(u),
      lastSignInAt: sessions.find((s) => s.userId === u.id)?._max.createdAt ?? null,
      activeSessions: live.find((s) => s.userId === u.id)?._count._all ?? 0,
    })),
    total,
    q.page,
    q.pageSize,
  );
}

export async function getUser(p: Principal, id: string) {
  assertPermission(p, "users.manage");
  const db = getDb();
  const u = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!u) throw notFound("User");
  const [sessions, events, pendingLink] = await Promise.all([
    db.authSession.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, expiresAt: true, userAgent: true, ipAddress: true },
    }),
    db.securityAuditEvent.findMany({
      where: { OR: [{ targetUserId: id }, { actorUserId: id }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 25,
      select: { id: true, createdAt: true, eventType: true, details: true, actor: { select: { email: true } }, target: { select: { email: true } } },
    }),
    db.passwordResetToken.findFirst({ where: { userId: id, usedAt: null, expiresAt: { gt: new Date() } }, select: { purpose: true, expiresAt: true } }),
  ]);
  return {
    ...userDto(u),
    sessions: sessions.map((s) => ({ ...s, current: s.id === p.sessionId })),
    pendingLink,
    events: events.map((e) => ({ id: e.id, createdAt: e.createdAt, type: e.eventType, details: e.details, actor: e.actor?.email ?? null, target: e.target?.email ?? null })),
    self: u.id === p.userId,
  };
}

export async function listAuditEvents(p: Principal, q: z.output<typeof auditListQuery>) {
  assertPermission(p, "users.manage");
  const db = getDb();
  const where: Prisma.SecurityAuditEventWhereInput = {
    AND: [q.userId ? { OR: [{ targetUserId: q.userId }, { actorUserId: q.userId }] } : {}, q.type ? { eventType: q.type } : {}],
  };
  const [rows, total] = await db.$transaction([
    db.securityAuditEvent.findMany({
      where,
      orderBy: [{ createdAt: q.dir }, { id: "desc" }],
      ...skipTake(q.page, q.pageSize),
      select: { id: true, createdAt: true, eventType: true, details: true, actor: { select: { email: true } }, target: { select: { email: true } } },
    }),
    db.securityAuditEvent.count({ where }),
  ]);
  return paged(
    rows.map((e) => ({ id: e.id, createdAt: e.createdAt, type: e.eventType, details: e.details, actor: e.actor?.email ?? null, target: e.target?.email ?? null })),
    total,
    q.page,
    q.pageSize,
  );
}

/* -------------------------------------------------------------- writes */

/** Creates a login account (optionally for an employee) and returns its one-time setup link. */
export async function createUser(p: Principal, input: z.output<typeof userCreateSchema>, origin: string) {
  assertPermission(p, "users.manage");
  const db = getDb();
  try {
    return await db.$transaction(async (tx) => {
      if (input.employeeId) {
        const e = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { userId: true, isActive: true } });
        if (!e) throw notFound("Employee");
        if (e.userId) throw conflict("EMPLOYEE_HAS_ACCOUNT", "This employee already has a login account.");
        if (!e.isActive) throw conflict("EMPLOYEE_INACTIVE", "Reactivate the employee before creating an account.");
      }
      // No usable password until the person follows the setup link.
      const unusable = await hash(randomBytes(32).toString("base64"), PASSWORD_HASH_COST);
      const user = await tx.user.create({ data: { email: input.email, role: input.role, passwordHash: unusable }, select: { id: true } });
      if (input.employeeId) await tx.employee.update({ where: { id: input.employeeId }, data: { userId: user.id } });
      const link = await issueLink(tx, user.id, "SETUP", p.userId, SETUP_LINK_HOURS);
      await audit(tx, { type: "USER_CREATED", actorUserId: p.userId, targetUserId: user.id, details: { role: input.role, employeeLinked: !!input.employeeId } });
      await audit(tx, { type: "SETUP_LINK_ISSUED", actorUserId: p.userId, targetUserId: user.id, details: { expiresInHours: SETUP_LINK_HOURS } });
      const created = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: USER_SELECT });
      return { user: userDto(created), setupLink: { url: linkFor(origin, link.token), expiresAt: link.expiresAt } };
    });
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

/** Role, active flag and employee link. Sessions are revoked on role change and deactivation. */
export async function updateUser(p: Principal, id: string, input: z.output<typeof userPatchSchema>) {
  assertPermission(p, "users.manage");
  if (id === p.userId && (input.role !== undefined || input.isActive !== undefined)) {
    throw new AppError(403, "CANNOT_MODIFY_SELF", "You can't change your own role or status. Ask another administrator.");
  }
  const db = getDb();
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_LOCK}::bigint)`;
      const u = await tx.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true, employee: { select: { id: true, isActive: true } } } });
      if (!u) throw notFound("User");
      const losesAdmin = u.role === "ADMIN" && u.isActive && ((input.role !== undefined && input.role !== "ADMIN") || input.isActive === false);
      if (losesAdmin && (await otherActiveAdmins(tx, id)) === 0) {
        throw conflict("LAST_ADMIN", "This is the last active administrator. Make another user an administrator first.");
      }

      if (input.employeeId !== undefined && input.employeeId !== (u.employee?.id ?? null)) {
        if (input.employeeId) {
          const e = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { userId: true } });
          if (!e) throw notFound("Employee");
          if (e.userId) throw conflict("EMPLOYEE_HAS_ACCOUNT", "This employee already has a login account.");
          if (u.employee) await tx.employee.update({ where: { id: u.employee.id }, data: { userId: null } });
          await tx.employee.update({ where: { id: input.employeeId }, data: { userId: id } });
          await audit(tx, { type: "EMPLOYEE_LINKED", actorUserId: p.userId, targetUserId: id, details: { employeeId: input.employeeId } });
        } else if (u.employee) {
          await tx.employee.update({ where: { id: u.employee.id }, data: { userId: null } });
          await audit(tx, { type: "EMPLOYEE_UNLINKED", actorUserId: p.userId, targetUserId: id, details: { employeeId: u.employee.id } });
        }
        // Scope (which customers a representative sees) follows the employee link: start fresh sessions.
        await revokeUserSessions(id, { tx });
      }

      if (input.role !== undefined && input.role !== u.role) {
        await tx.user.update({ where: { id }, data: { role: input.role } });
        const n = await revokeUserSessions(id, { tx });
        await audit(tx, { type: "ROLE_CHANGED", actorUserId: p.userId, targetUserId: id, details: { from: u.role, to: input.role, sessionsRevoked: n } });
      }

      if (input.isActive !== undefined && input.isActive !== u.isActive) {
        if (input.isActive) {
          const employeeId = input.employeeId === undefined ? u.employee?.id : input.employeeId;
          const employee = employeeId ? await tx.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } }) : null;
          if (employee && !employee.isActive) throw conflict("EMPLOYEE_INACTIVE", "Reactivate the employee record first (Employees screen).");
          await tx.user.update({ where: { id }, data: { isActive: true } });
          await audit(tx, { type: "USER_ACTIVATED", actorUserId: p.userId, targetUserId: id });
        } else {
          await tx.user.update({ where: { id }, data: { isActive: false } });
          const n = await revokeUserSessions(id, { tx });
          await audit(tx, { type: "USER_DEACTIVATED", actorUserId: p.userId, targetUserId: id, details: { sessionsRevoked: n } });
        }
      }
    });
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return getUser(p, id);
}

/** A one-time reset link (24 h). The user's sessions end now; their old password works until the link is used. */
export async function issuePasswordReset(p: Principal, id: string, origin: string) {
  assertPermission(p, "users.manage");
  if (id === p.userId) throw conflict("USE_CHANGE_PASSWORD", "Change your own password from your account page.");
  const db = getDb();
  return db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!u) throw notFound("User");
    if (!u.isActive) throw conflict("USER_INACTIVE", "Reactivate the account before resetting its password.");
    const link = await issueLink(tx, id, "RESET", p.userId, RESET_LINK_HOURS);
    const n = await revokeUserSessions(id, { tx });
    await audit(tx, { type: "PASSWORD_RESET_ISSUED", actorUserId: p.userId, targetUserId: id, details: { expiresInHours: RESET_LINK_HOURS, sessionsRevoked: n } });
    return { resetLink: { url: linkFor(origin, link.token), expiresAt: link.expiresAt } };
  });
}

/** For a user who lost their authenticator: MFA off, recovery codes deleted, sessions revoked. */
export async function resetUserMfa(p: Principal, id: string) {
  assertPermission(p, "users.manage");
  if (id === p.userId) throw conflict("USE_ACCOUNT_PAGE", "Manage your own MFA from your account page.");
  const db = getDb();
  await db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { mfaEnabled: true } });
    if (!u) throw notFound("User");
    if (!u.mfaEnabled) throw conflict("MFA_NOT_ENABLED", "MFA is not on for this user.");
    await tx.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastCounter: null } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: id } });
    const n = await revokeUserSessions(id, { tx });
    await audit(tx, { type: "MFA_RESET_BY_ADMIN", actorUserId: p.userId, targetUserId: id, details: { sessionsRevoked: n } });
  });
  return getUser(p, id);
}

/** Ends one session or all sessions of a user. */
export async function adminRevokeSessions(p: Principal, id: string, sessionId?: string) {
  assertPermission(p, "users.manage");
  const db = getDb();
  const exists = await db.user.count({ where: { id } });
  if (!exists) throw notFound("User");
  const res = sessionId
    ? await db.authSession.updateMany({ where: { id: sessionId, userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
    : { count: await revokeUserSessions(id) };
  if (sessionId && res.count !== 1) throw notFound("Session");
  await audit(db, { type: "SESSIONS_REVOKED_BY_ADMIN", actorUserId: p.userId, targetUserId: id, details: { revoked: res.count, single: !!sessionId } });
  return { revoked: res.count };
}

/* ------------------------------------------------------------- public */

const linkInvalid = () => new AppError(410, "RESET_LINK_INVALID", "This link is invalid, already used or expired. Ask your administrator for a new one.");

/**
 * Completes a setup or reset link (no session needed): sets the password,
 * consumes the link and every other open link, revokes all sessions and clears
 * the sign-in throttle. MFA, if enabled, still applies at the next sign-in.
 */
export async function completePasswordReset(input: z.output<typeof resetCompletionSchema>) {
  const db = getDb();
  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: { id: true, purpose: true, usedAt: true, expiresAt: true, user: { select: { id: true, email: true, isActive: true, employee: { select: { firstName: true, lastName: true, isActive: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date() || !row.user.isActive || row.user.employee?.isActive === false) throw linkInvalid();
  const problem = passwordProblem(input.newPassword, { email: row.user.email, names: row.user.employee ? [row.user.employee.firstName, row.user.employee.lastName] : [] });
  if (problem) throw invalid(problem, { newPassword: [problem] });
  const passwordHash = await hash(input.newPassword, PASSWORD_HASH_COST);
  await db.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw linkInvalid();
    await tx.passwordResetToken.updateMany({ where: { userId: row.user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: row.user.id }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } });
    const n = await revokeUserSessions(row.user.id, { tx });
    await audit(tx, { type: "PASSWORD_RESET_COMPLETED", actorUserId: row.user.id, targetUserId: row.user.id, details: { purpose: row.purpose, sessionsRevoked: n } });
  });
  await clearThrottle("email", row.user.email);
  return { email: row.user.email };
}
