import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetLoginThrottle, verifyCredentials } from "@/server/auth/credentials";
import { DEMO_PASSWORD } from "../support/env";
import { db, MANAGER, REP_KORCE } from "../support/fixtures";

describe("credential verification (Auth.js authorize)", () => {
  beforeEach(() => resetLoginThrottle());
  afterAll(async () => {
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: true } });
    await db().employee.updateMany({ where: { user: { email: MANAGER } }, data: { isActive: true } });
  });

  it("accepts a correct email and password (email is case-insensitive)", async () => {
    const u = await verifyCredentials({ email: "  Manager@SalesFlow.test ", password: DEMO_PASSWORD });
    expect(u).toMatchObject({ email: MANAGER });
    expect(Object.keys(u!)).toEqual(["id", "email"]); // no hash, no role in the token
  });

  it("rejects a wrong password, an unknown email and malformed input", async () => {
    expect(await verifyCredentials({ email: MANAGER, password: "wrong-password" })).toBeNull();
    expect(await verifyCredentials({ email: "nobody@salesflow.test", password: DEMO_PASSWORD })).toBeNull();
    expect(await verifyCredentials({ email: "not-an-email", password: DEMO_PASSWORD })).toBeNull();
    expect(await verifyCredentials({ email: MANAGER })).toBeNull();
    expect(await verifyCredentials(null)).toBeNull();
  });

  it("rejects a disabled user even with the right password", async () => {
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: false } });
    expect(await verifyCredentials({ email: REP_KORCE, password: DEMO_PASSWORD })).toBeNull();
    await db().user.update({ where: { email: REP_KORCE }, data: { isActive: true } });
    expect(await verifyCredentials({ email: REP_KORCE, password: DEMO_PASSWORD })).not.toBeNull();
  });

  it("rejects a user whose employee record is disabled", async () => {
    await db().employee.updateMany({ where: { user: { email: MANAGER } }, data: { isActive: false } });
    expect(await verifyCredentials({ email: MANAGER, password: DEMO_PASSWORD })).toBeNull();
    await db().employee.updateMany({ where: { user: { email: MANAGER } }, data: { isActive: true } });
  });

  it("stores bcrypt hashes, never plain passwords", async () => {
    const u = await db().user.findUniqueOrThrow({ where: { email: MANAGER } });
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(u.passwordHash).not.toContain(DEMO_PASSWORD);
  });

  it("throttles repeated failures for an email, even for the right password afterwards", async () => {
    for (let i = 0; i < 10; i++) await verifyCredentials({ email: MANAGER, password: "wrong-" + i });
    expect(await verifyCredentials({ email: MANAGER, password: DEMO_PASSWORD })).toBeNull();
    await resetLoginThrottle();
    expect(await verifyCredentials({ email: MANAGER, password: DEMO_PASSWORD })).not.toBeNull();
  });
});
