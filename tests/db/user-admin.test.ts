import { afterEach, describe, expect, it } from "vitest";
import { TOTP } from "otpauth";
import { authenticate, resetLoginThrottle, verifyCredentials } from "@/server/auth/credentials";
import { loadPrincipal } from "@/server/auth/load-principal";
import type { Principal } from "@/server/auth/principal";
import { createSession } from "@/server/auth/sessions";
import {
  changePassword,
  disableMfa,
  enableMfa,
  getAccount,
  listOwnSessions,
  regenerateRecoveryCodes,
  revokeOtherSessions,
  revokeOwnSession,
  startMfaSetup,
} from "@/server/services/account";
import { createEmployee, updateEmployee } from "@/server/services/employees";
import {
  adminRevokeSessions,
  completePasswordReset,
  createUser,
  getUser,
  issuePasswordReset,
  listAuditEvents,
  auditListQuery,
  listUsers,
  resetUserMfa,
  updateUser,
} from "@/server/services/users";
import { ADMIN, db, dbError, errorCode, MANAGER, principalFor, REP_TIRANA } from "../support/fixtures";

/** Phase 6B: user administration, passwords, MFA, sessions and the audit log. */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Harbour-Lantern-Seventeen";
let n = 0;
const uniqueEmail = () => `user6b.${Date.now()}.${++n}@salesflow.test`;
const tokenOf = (url: string) => url.split("#token=")[1];

/** A fresh account with a known password (created by the admin, set through its setup link). */
async function freshUser(role: "ADMIN" | "SALES_MANAGER" | "SALES_REPRESENTATIVE" = "SALES_MANAGER") {
  const admin = await principalFor(ADMIN);
  const email = uniqueEmail();
  const created = await createUser(admin, { email, role }, ORIGIN);
  await completePasswordReset({ token: tokenOf(created.setupLink.url), newPassword: PASSWORD });
  return { id: created.user.id, email };
}

/** The principal for a user with a live session (as the session layer would build it). */
async function signedIn(email: string): Promise<Principal> {
  const p = await principalFor(email);
  const sessionId = await createSession(p.userId);
  return (await loadPrincipal(p.userId, sessionId))!;
}

const totpCode = (secret: string, offsetSteps = 0) => TOTP.generate({ secret, timestamp: Date.now() + offsetSteps * 30_000 });

afterEach(async () => {
  await resetLoginThrottle();
});

describe("account creation", () => {
  it("creates an account without a usable password and returns a one-time setup link", async () => {
    const admin = await principalFor(ADMIN);
    const email = uniqueEmail();
    const res = await createUser(admin, { email, role: "SALES_REPRESENTATIVE" }, ORIGIN);
    expect(res.setupLink.url).toMatch(/^http:\/\/localhost:3000\/reset-password#token=[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(res.user)).not.toMatch(/passwordHash|token/i);
    const token = tokenOf(res.setupLink.url);
    const stored = await db().passwordResetToken.findFirstOrThrow({ where: { userId: res.user.id } });
    expect(stored.tokenHash).not.toBe(token); // only a hash is stored
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await verifyCredentials({ email, password: "anything-at-all-123" })).toBeNull();
    const u = await db().user.findUniqueOrThrow({ where: { id: res.user.id } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("refuses duplicate emails, taken employees, inactive employees and non-administrators", async () => {
    const admin = await principalFor(ADMIN);
    const manager = await principalFor(MANAGER);
    expect(await errorCode(createUser(admin, { email: MANAGER, role: "SALES_MANAGER" }, ORIGIN))).toBe("DUPLICATE_EMAIL");
    const taken = await db().employee.findFirstOrThrow({ where: { userId: { not: null } } });
    expect(await errorCode(createUser(admin, { email: uniqueEmail(), role: "SALES_MANAGER", employeeId: taken.id }, ORIGIN))).toBe("EMPLOYEE_HAS_ACCOUNT");
    const inactive = await createEmployee(admin, { firstName: "Inactive", lastName: "Person", isActive: false });
    expect(await errorCode(createUser(admin, { email: uniqueEmail(), role: "SALES_MANAGER", employeeId: inactive.id }, ORIGIN))).toBe("EMPLOYEE_INACTIVE");
    expect(await errorCode(createUser(manager, { email: uniqueEmail(), role: "ADMIN" }, ORIGIN))).toBe("FORBIDDEN");
    expect(await errorCode(listUsers(manager))).toBe("FORBIDDEN");
  });

  it("links an employee at creation, and the setup link sets the password once", async () => {
    const admin = await principalFor(ADMIN);
    const e = await createEmployee(admin, { firstName: "Teuta", lastName: "Gashi" });
    const email = uniqueEmail();
    const res = await createUser(admin, { email, role: "SALES_REPRESENTATIVE", employeeId: e.id }, ORIGIN);
    expect(res.user.employee).toMatchObject({ id: e.id, name: "Teuta Gashi" });
    const token = tokenOf(res.setupLink.url);
    expect(await errorCode(completePasswordReset({ token, newPassword: "short" }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(completePasswordReset({ token, newPassword: "teuta-gashi-password-1" }))).toBe("VALIDATION_FAILED"); // contains the name
    await completePasswordReset({ token, newPassword: PASSWORD });
    expect(await verifyCredentials({ email, password: PASSWORD })).not.toBeNull();
    expect(await errorCode(completePasswordReset({ token, newPassword: "Another-Long-Password-9" }))).toBe("RESET_LINK_INVALID"); // single use
    expect(await errorCode(completePasswordReset({ token: "x".repeat(43), newPassword: PASSWORD }))).toBe("RESET_LINK_INVALID");
  });

  it("an administrator-set password (employee screen) must be changed first", async () => {
    const admin = await principalFor(ADMIN);
    const email = uniqueEmail();
    await createEmployee(admin, { firstName: "Initial", lastName: "Password", account: { email, role: "SALES_MANAGER", password: "Temporary-Granite-Door" } });
    const p = await signedIn(email);
    expect(p.mustChangePassword).toBe(true);
    await changePassword(p, { currentPassword: "Temporary-Granite-Door", newPassword: PASSWORD });
    expect((await signedIn(email)).mustChangePassword).toBe(false);
  });
});

describe("password management", () => {
  it("changes the password after re-authentication, refuses reuse and weak passwords, keeps only this session", async () => {
    const u = await freshUser();
    const p = await signedIn(u.email);
    const other = await createSession(u.id);
    expect(await errorCode(changePassword(p, { currentPassword: "wrong-password-xyz", newPassword: "Brand-New-Password-42" }))).toBe("REAUTH_FAILED");
    expect(await errorCode(changePassword(p, { currentPassword: PASSWORD, newPassword: PASSWORD }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(changePassword(p, { currentPassword: PASSWORD, newPassword: "password1234" }))).toBe("VALIDATION_FAILED");
    const res = await changePassword(p, { currentPassword: PASSWORD, newPassword: "Brand-New-Password-42" });
    expect(res.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await loadPrincipal(u.id, other)).toBeNull();
    expect(await loadPrincipal(u.id, p.sessionId!)).not.toBeNull();
    expect(await verifyCredentials({ email: u.email, password: PASSWORD })).toBeNull();
    expect(await verifyCredentials({ email: u.email, password: "Brand-New-Password-42" })).not.toBeNull();
  });

  it("administrator reset: sessions end, a single-use link replaces the password", async () => {
    const admin = await principalFor(ADMIN);
    const u = await freshUser();
    const session = await createSession(u.id);
    const { resetLink } = await issuePasswordReset(admin, u.id, ORIGIN);
    expect(await loadPrincipal(u.id, session)).toBeNull();
    expect(await errorCode(issuePasswordReset(admin, admin.userId, ORIGIN))).toBe("USE_CHANGE_PASSWORD");
    const second = await issuePasswordReset(admin, u.id, ORIGIN);
    expect(await errorCode(completePasswordReset({ token: tokenOf(resetLink.url), newPassword: "Reset-Password-Value-1" }))).toBe("RESET_LINK_INVALID"); // superseded
    await completePasswordReset({ token: tokenOf(second.resetLink.url), newPassword: "Reset-Password-Value-1" });
    expect(await verifyCredentials({ email: u.email, password: PASSWORD })).toBeNull();
    expect(await verifyCredentials({ email: u.email, password: "Reset-Password-Value-1" })).not.toBeNull();
  });

  it("expired links don't work", async () => {
    const admin = await principalFor(ADMIN);
    const u = await freshUser();
    const { resetLink } = await issuePasswordReset(admin, u.id, ORIGIN);
    await db().passwordResetToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() + 1000), createdAt: new Date(Date.now() - 3600_000) } });
    await new Promise((r) => setTimeout(r, 1100));
    expect(await errorCode(completePasswordReset({ token: tokenOf(resetLink.url), newPassword: "Reset-Password-Value-2" }))).toBe("RESET_LINK_INVALID");
  });
});

describe("roles, activation and the last administrator", () => {
  it("role changes apply at once, revoke sessions and can't target yourself", async () => {
    const admin = await principalFor(ADMIN);
    const u = await freshUser("SALES_MANAGER");
    const session = await createSession(u.id);
    await updateUser(admin, u.id, { role: "SALES_REPRESENTATIVE" });
    expect(await loadPrincipal(u.id, session)).toBeNull(); // signed out
    expect((await signedIn(u.email)).role).toBe("SALES_REPRESENTATIVE");
    expect(await errorCode(updateUser(admin, admin.userId, { role: "SALES_MANAGER" }))).toBe("CANNOT_MODIFY_SELF");
    expect(await errorCode(updateUser(admin, admin.userId, { isActive: false }))).toBe("CANNOT_MODIFY_SELF");
    const manager = await principalFor(MANAGER);
    expect(await errorCode(updateUser(manager, manager.userId, { role: "ADMIN" }))).toBe("FORBIDDEN"); // no self-escalation
    expect(await errorCode(updateUser(manager, u.id, { role: "ADMIN" }))).toBe("FORBIDDEN");
  });

  it("keeps at least one active administrator, even when two demote each other at once", async () => {
    const seeded = await principalFor(ADMIN);
    const second = await freshUser("ADMIN");
    const secondP = await signedIn(second.email);
    try {
      const results = await Promise.allSettled([updateUser(seeded, second.id, { role: "SALES_MANAGER" }), updateUser(secondP, seeded.userId, { role: "SALES_MANAGER" })]);
      const codes = results.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code: string }).code)).sort();
      expect(codes).toEqual(["LAST_ADMIN", "ok"]);
      expect(await db().user.count({ where: { role: "ADMIN", isActive: true } })).toBeGreaterThanOrEqual(1);
    } finally {
      await db().user.update({ where: { id: seeded.userId }, data: { role: "ADMIN", isActive: true } });
      await db().user.update({ where: { id: second.id }, data: { role: "SALES_MANAGER" } });
    }
  });

  it("deactivation ends sessions, blocks sign-in and keeps sales attribution; reactivation follows the employee", async () => {
    const admin = await principalFor(ADMIN);
    const e = await createEmployee(admin, { firstName: "Arta", lastName: "Hoxhaj" });
    const email = uniqueEmail();
    const created = await createUser(admin, { email, role: "SALES_REPRESENTATIVE", employeeId: e.id }, ORIGIN);
    await completePasswordReset({ token: tokenOf(created.setupLink.url), newPassword: PASSWORD });
    const customer = await db().customer.findFirstOrThrow();
    const order = await db().order.create({ data: { orderNumber: "T-6B-" + Date.now(), customerId: customer.id, salesRepId: e.id, currencyCode: "ALL", allPerUnit: "1" } });
    const session = await createSession(created.user.id);

    await updateUser(admin, created.user.id, { isActive: false });
    expect(await loadPrincipal(created.user.id, session)).toBeNull();
    expect(await verifyCredentials({ email, password: PASSWORD })).toBeNull();
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).salesRepId).toBe(e.id);

    await updateUser(admin, created.user.id, { isActive: true });
    expect(await verifyCredentials({ email, password: PASSWORD })).not.toBeNull();

    // Deactivating the employee deactivates the login too; the login can't be reactivated while the employee is inactive.
    await updateEmployee(admin, e.id, { isActive: false });
    expect((await db().user.findUniqueOrThrow({ where: { id: created.user.id } })).isActive).toBe(false);
    expect(await errorCode(updateUser(admin, created.user.id, { isActive: true }))).toBe("EMPLOYEE_INACTIVE");
    await updateEmployee(admin, e.id, { isActive: true });
    expect((await db().user.findUniqueOrThrow({ where: { id: created.user.id } })).isActive).toBe(false); // reactivation is explicit
  });

  it("links and unlinks employees", async () => {
    const admin = await principalFor(ADMIN);
    const u = await freshUser("SALES_REPRESENTATIVE");
    const e = await createEmployee(admin, { firstName: "Link", lastName: "Target" });
    expect((await updateUser(admin, u.id, { employeeId: e.id })).employee?.id).toBe(e.id);
    const taken = await db().employee.findFirstOrThrow({ where: { userId: { not: null }, NOT: { id: e.id } } });
    expect(await errorCode(updateUser(admin, u.id, { employeeId: taken.id }))).toBe("EMPLOYEE_HAS_ACCOUNT");
    expect((await updateUser(admin, u.id, { employeeId: null })).employee).toBeNull();
  });
});

describe("sessions", () => {
  it("users list and revoke only their own sessions", async () => {
    const u = await freshUser();
    const p = await signedIn(u.email);
    const other = await createSession(u.id);
    const list = await listOwnSessions(p);
    expect(list.items.find((s) => s.id === p.sessionId)?.current).toBe(true);
    expect(list.items.map((s) => s.id)).toContain(other);
    const someoneElse = await signedIn(REP_TIRANA);
    expect(await errorCode(revokeOwnSession(someoneElse, other))).toBe("NOT_FOUND");
    await revokeOwnSession(p, other);
    expect(await loadPrincipal(u.id, other)).toBeNull();
    const third = await createSession(u.id);
    expect((await revokeOtherSessions(p)).revoked).toBe(1);
    expect(await loadPrincipal(u.id, third)).toBeNull();
    expect(await loadPrincipal(u.id, p.sessionId!)).not.toBeNull();
  });

  it("administrators revoke one or all sessions of a user", async () => {
    const admin = await principalFor(ADMIN);
    const u = await freshUser();
    const [a, b] = [await createSession(u.id), await createSession(u.id)];
    await adminRevokeSessions(admin, u.id, a);
    expect(await loadPrincipal(u.id, a)).toBeNull();
    expect(await loadPrincipal(u.id, b)).not.toBeNull();
    expect((await adminRevokeSessions(admin, u.id)).revoked).toBe(1);
    expect(await loadPrincipal(u.id, b)).toBeNull();
    expect(await errorCode(adminRevokeSessions(await principalFor(MANAGER), u.id))).toBe("FORBIDDEN");
  });
});

describe("multi-factor authentication", () => {
  async function enrolled() {
    const u = await freshUser();
    const p = await signedIn(u.email);
    const setup = await startMfaSetup(p, { currentPassword: PASSWORD });
    const { recoveryCodes } = await enableMfa(p, { code: totpCode(setup.secret) });
    return { ...u, p, secret: setup.secret, recoveryCodes };
  }

  it("needs the password to start, a valid code to enable, and never exposes the secret afterwards", async () => {
    const u = await freshUser();
    const p = await signedIn(u.email);
    expect(await errorCode(startMfaSetup(p, { currentPassword: "not-my-password" }))).toBe("REAUTH_FAILED");
    const setup = await startMfaSetup(p, { currentPassword: PASSWORD });
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain("otpauth://totp/SalesFlow");
    expect(setup.qrCode).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(await errorCode(enableMfa(p, { code: "000000" }))).toBe("VALIDATION_FAILED");
    const row = await db().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.mfaPendingSecret).toMatch(/^v1:/);
    expect(row.mfaPendingSecret).not.toContain(setup.secret); // encrypted at rest
    const { recoveryCodes } = await enableMfa(p, { code: totpCode(setup.secret) });
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    const account = await getAccount(p);
    expect(account.mfa).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    expect(JSON.stringify(account)).not.toContain(setup.secret);
    const stored = await db().mfaRecoveryCode.findMany({ where: { userId: u.id } });
    expect(stored.some((c) => recoveryCodes.some((rc) => c.codeHash.includes(rc.replace("-", ""))))).toBe(false);
    expect(await errorCode(startMfaSetup(p, { currentPassword: PASSWORD }))).toBe("MFA_ALREADY_ENABLED");
  });

  it("sign-in asks for a code, refuses wrong and replayed codes, and accepts a valid one", async () => {
    const u = await enrolled();
    expect(await authenticate({ email: u.email, password: PASSWORD })).toEqual({ status: "mfa_required" });
    expect(await authenticate({ email: u.email, password: "wrong-password-12" })).toEqual({ status: "failed" }); // no MFA hint without the password
    expect(await authenticate({ email: u.email, password: PASSWORD, code: "123456" })).toEqual({ status: "mfa_invalid" });
    const next = totpCode(u.secret, 1); // the step after the one used to enable
    expect((await authenticate({ email: u.email, password: PASSWORD, code: next })).status).toBe("ok");
    expect(await authenticate({ email: u.email, password: PASSWORD, code: next })).toEqual({ status: "mfa_invalid" }); // replay
  });

  it("recovery codes work once", async () => {
    const u = await enrolled();
    const code = u.recoveryCodes[0];
    expect((await authenticate({ email: u.email, password: PASSWORD, code })).status).toBe("ok");
    expect(await authenticate({ email: u.email, password: PASSWORD, code })).toEqual({ status: "mfa_invalid" });
    expect((await authenticate({ email: u.email, password: PASSWORD, code: code.toUpperCase().replace("-", " ") })).status).toBe("mfa_invalid");
    expect((await getAccount(u.p)).mfa.recoveryCodesLeft).toBe(9);
    const events = await listAuditEvents(await principalFor(ADMIN), auditListQuery.parse({ userId: u.id, type: "RECOVERY_CODE_USED" }));
    expect(events.total).toBe(1);
  });

  it("locks MFA checks after 5 wrong codes", async () => {
    const u = await enrolled();
    for (let i = 0; i < 5; i++) expect((await authenticate({ email: u.email, password: PASSWORD, code: "11111" + i })).status).toBe("mfa_invalid");
    expect(await authenticate({ email: u.email, password: PASSWORD, code: totpCode(u.secret, 1) })).toEqual({ status: "mfa_invalid" });
  });

  it("disabling and regenerating need the password and a code; administrators can reset MFA", async () => {
    const u = await enrolled();
    expect(await errorCode(disableMfa(u.p, { currentPassword: PASSWORD }))).toBe("MFA_REQUIRED");
    expect(await errorCode(regenerateRecoveryCodes(u.p, { currentPassword: PASSWORD, code: "999999" }))).toBe("MFA_INVALID");
    const fresh = await regenerateRecoveryCodes(u.p, { currentPassword: PASSWORD, code: u.recoveryCodes[1] });
    expect(fresh.recoveryCodes).toHaveLength(10);
    expect((await authenticate({ email: u.email, password: PASSWORD, code: u.recoveryCodes[2] })).status).toBe("mfa_invalid"); // old codes gone
    await disableMfa(u.p, { currentPassword: PASSWORD, code: fresh.recoveryCodes[0] });
    expect((await authenticate({ email: u.email, password: PASSWORD })).status).toBe("ok");
    expect(await db().mfaRecoveryCode.count({ where: { userId: u.id } })).toBe(0);

    const v = await enrolled();
    const admin = await principalFor(ADMIN);
    const session = await createSession(v.id);
    await resetUserMfa(admin, v.id);
    expect(await loadPrincipal(v.id, session)).toBeNull();
    expect((await authenticate({ email: v.email, password: PASSWORD })).status).toBe("ok");
  });
});

describe("security audit log", () => {
  it("records actor, target, type and time for every administrative change, and nothing secret", async () => {
    const admin = await principalFor(ADMIN);
    const email = uniqueEmail();
    const created = await createUser(admin, { email, role: "SALES_MANAGER" }, ORIGIN);
    const token = tokenOf(created.setupLink.url);
    await completePasswordReset({ token, newPassword: PASSWORD });
    await updateUser(admin, created.user.id, { role: "SALES_REPRESENTATIVE" });
    const { resetLink } = await issuePasswordReset(admin, created.user.id, ORIGIN);
    await updateUser(admin, created.user.id, { isActive: false });
    const detail = await getUser(admin, created.user.id);
    const types = detail.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["USER_CREATED", "SETUP_LINK_ISSUED", "PASSWORD_RESET_COMPLETED", "ROLE_CHANGED", "PASSWORD_RESET_ISSUED", "USER_DEACTIVATED"]));
    const role = await db().securityAuditEvent.findFirstOrThrow({ where: { targetUserId: created.user.id, eventType: "ROLE_CHANGED" } });
    expect(role).toMatchObject({ actorUserId: admin.userId, details: { from: "SALES_MANAGER", to: "SALES_REPRESENTATIVE" } });
    expect(role.createdAt).toBeInstanceOf(Date);
    const all = JSON.stringify(await db().securityAuditEvent.findMany({ where: { targetUserId: created.user.id } }));
    for (const secret of [token, tokenOf(resetLink.url), PASSWORD]) expect(all).not.toContain(secret);
  });

  it("is append-only and visible to administrators only", async () => {
    const e = await db().securityAuditEvent.findFirstOrThrow();
    expect(await dbError(db().securityAuditEvent.update({ where: { id: e.id }, data: { eventType: "USER_CREATED" } }))).toBe("Security audit events are append-only");
    expect(await dbError(db().securityAuditEvent.delete({ where: { id: e.id } }))).toBe("Security audit events are append-only");
    expect(await errorCode(listAuditEvents(await principalFor(MANAGER), auditListQuery.parse({})))).toBe("FORBIDDEN");
  });
});
