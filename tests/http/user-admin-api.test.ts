import { TOTP } from "otpauth";
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { ADMIN, db, MANAGER, REP_TIRANA } from "../support/fixtures";
import { api, base, signIn, signInResult } from "../support/http";

/** Phase 6B over HTTP: administration, password links, forced change, MFA sign-in and sessions. */
describe.skipIf(!base)("user administration and account security over HTTP", () => {
  let admin: string, manager: string, rep: string;
  const PASSWORD = "Copper-Window-Ninety-One";
  let n = 0;
  const uniqueEmail = () => `http6b.${Date.now()}.${++n}@salesflow.test`;

  beforeAll(async () => {
    [admin, manager, rep] = (await Promise.all([ADMIN, MANAGER, REP_TIRANA].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
  });

  /** Creates an account through the API and sets its password through the public setup link. */
  async function provision(role = "SALES_MANAGER") {
    const email = uniqueEmail();
    const res = await api.post("/api/users", { email, role }, admin);
    expect(res.status).toBe(201);
    const body = await res.json();
    const token = body.setupLink.url.split("#token=")[1];
    const done = await api.post("/api/password-reset", { token, newPassword: PASSWORD });
    expect(done.status).toBe(200);
    return { id: body.user.id as string, email, cookie: (await signIn(email, PASSWORD))! };
  }

  it("answers 401 without a session and 403 to non-administrators", async () => {
    const id = crypto.randomUUID();
    for (const path of ["/api/users", `/api/users/${id}`, "/api/audit-events", "/api/account", "/api/account/sessions"]) expect((await api.get(path)).status, path).toBe(401);
    for (const cookie of [manager, rep]) {
      expect((await api.get("/api/users", cookie)).status).toBe(403);
      expect((await api.get("/api/audit-events", cookie)).status).toBe(403);
      expect((await api.post("/api/users", { email: uniqueEmail(), role: "ADMIN" }, cookie)).status).toBe(403);
      expect((await api.patch(`/api/users/${id}`, { role: "ADMIN" }, cookie)).status).toBe(403);
      expect((await api.post(`/api/users/${id}/password-reset`, {}, cookie)).status).toBe(403);
    }
    expect((await api.get("/api/users", admin)).status).toBe(200);
  });

  it("creates accounts with a one-time link and never returns password hashes", async () => {
    const u = await provision();
    const list = await (await api.get(`/api/users?q=${encodeURIComponent(u.email)}`, admin)).json();
    expect(list.items).toHaveLength(1);
    const detail = await (await api.get(`/api/users/${u.id}`, admin)).json();
    expect(JSON.stringify([list, detail])).not.toMatch(/passwordHash|\$2[aby]\$|tokenHash|mfaSecret/);
    expect((await api.post("/api/users", { email: u.email, role: "SALES_MANAGER" }, admin)).status).toBe(409);
    expect((await api.post("/api/users", { email: uniqueEmail(), role: "SALES_MANAGER", password: "Not-Allowed-Here-1" }, admin)).status).toBe(422);
    expect((await api.post("/api/password-reset", { token: "x".repeat(43), newPassword: PASSWORD })).status).toBe(410);
  });

  it("enforces an administrator-set password change before anything else", async () => {
    const email = uniqueEmail();
    const created = await api.post("/api/employees", { firstName: "Forced", lastName: "Change", account: { email, role: "SALES_MANAGER", password: "Temporary-Granite-Door" } }, admin);
    expect(created.status).toBe(201);
    const cookie = (await signIn(email, "Temporary-Granite-Door"))!;
    const blocked = await api.get("/api/orders", cookie);
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await (await api.get("/api/me", cookie)).json()).mustChangePassword).toBe(true);
    expect((await api.post("/api/account/password", { currentPassword: "Temporary-Granite-Door", newPassword: PASSWORD }, cookie)).status).toBe(200);
    expect((await api.get("/api/orders", cookie)).status).toBe(200);
  });

  it("revoked and deactivated accounts lose API access immediately", async () => {
    const u = await provision();
    expect((await api.get("/api/me", u.cookie)).status).toBe(200);
    expect((await api.post(`/api/users/${u.id}/sessions/revoke`, {}, admin)).status).toBe(200);
    expect((await api.get("/api/me", u.cookie)).status).toBe(401);
    const again = (await signIn(u.email, PASSWORD))!;
    expect((await api.patch(`/api/users/${u.id}`, { isActive: false }, admin)).status).toBe(200);
    expect((await api.get("/api/me", again)).status).toBe(401);
    expect(await signIn(u.email, PASSWORD)).toBeNull();
  });

  it("role changes apply on the next request; administrators can't change themselves", async () => {
    const u = await provision("SALES_MANAGER");
    expect((await api.get("/api/employees", u.cookie)).status).toBe(200); // managers see employees
    expect((await api.patch(`/api/users/${u.id}`, { role: "SALES_REPRESENTATIVE" }, admin)).status).toBe(200);
    const fresh = (await signIn(u.email, PASSWORD))!;
    expect((await api.get("/api/employees", fresh)).status).toBe(403);
    const me = (await (await api.get("/api/me", admin)).json()) as { user: { email: string } };
    const self = await db().user.findUniqueOrThrow({ where: { email: me.user.email } });
    const res = await api.patch(`/api/users/${self.id}`, { role: "SALES_MANAGER" }, admin);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("signs in with MFA in two steps and refuses a wrong or replayed code", async () => {
    const u = await provision();
    const setup = await (await api.post("/api/account/mfa/setup", { currentPassword: PASSWORD }, u.cookie)).json();
    const enable = await api.post("/api/account/mfa/enable", { code: TOTP.generate({ secret: setup.secret }) }, u.cookie);
    expect(enable.status).toBe(200);
    expect((await enable.json()).recoveryCodes).toHaveLength(10);
    const account = await (await api.get("/api/account", u.cookie)).json();
    expect(JSON.stringify(account)).not.toContain(setup.secret);

    const first = await signInResult(u.email, PASSWORD);
    expect(first.cookie).toBeNull();
    expect(first.location).toContain("code=mfa_required");
    const wrong = await signInResult(u.email, PASSWORD, "000000");
    expect([wrong.cookie, wrong.location.includes("code=mfa_invalid")]).toEqual([null, true]);
    const code = TOTP.generate({ secret: setup.secret, timestamp: Date.now() + 30_000 });
    const ok = await signInResult(u.email, PASSWORD, code);
    expect(ok.cookie).not.toBeNull();
    expect((await api.get("/api/me", ok.cookie!)).status).toBe(200);
    expect((await signInResult(u.email, PASSWORD, code)).cookie).toBeNull(); // replay
  });

  it("lists own sessions, revokes others, and can't touch another user's session", async () => {
    const u = await provision();
    const second = (await signIn(u.email, PASSWORD))!;
    const mine = (await (await api.get("/api/account/sessions", u.cookie)).json()).items as { id: string; current: boolean }[];
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.filter((s) => s.current)).toHaveLength(1);
    const other = await provision();
    const otherSessions = (await (await api.get("/api/account/sessions", other.cookie)).json()).items as { id: string }[];
    expect((await api.del(`/api/account/sessions/${otherSessions[0].id}`, u.cookie)).status).toBe(404);
    expect((await api.post("/api/account/sessions/revoke-others", {}, u.cookie)).status).toBe(200);
    expect((await api.get("/api/me", second)).status).toBe(401);
    expect((await api.get("/api/me", u.cookie)).status).toBe(200);
  });

  it("exposes the audit log to administrators", async () => {
    const u = await provision();
    const events = await (await api.get(`/api/audit-events?userId=${u.id}`, admin)).json();
    expect(events.items.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["USER_CREATED", "SETUP_LINK_ISSUED", "PASSWORD_RESET_COMPLETED"]));
    expect((await api.get("/api/audit-events?type=NOT_A_TYPE", admin)).status).toBe(422);
  });
});
