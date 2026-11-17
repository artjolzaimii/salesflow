import { describe, expect, it } from "vitest";
import { resetLoginThrottle, verifyCredentials } from "@/server/auth/credentials";
import { loadPrincipal } from "@/server/auth/load-principal";
import { createSession } from "@/server/auth/sessions";
import { createCustomer } from "@/server/services/customers";
import { createEmployee, employeeListQuery, getEmployee, listEmployees, reassignCustomers, updateEmployee } from "@/server/services/employees";
import { ADMIN, db, errorCode, freshNipt, MANAGER, principalFor, REP_TIRANA } from "../support/fixtures";

const uniqueEmail = () => `rep.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@salesflow.test`;
const customer = (repId: string) => ({
  businessName: "Emp Test " + Math.random().toString(36).slice(2, 6),
  nipt: freshNipt(),
  businessType: "HOTEL",
  city: "Vlorë",
  assignedRepId: repId,
  contacts: [{ fullName: "C" }],
  addresses: [{ street: "S", city: "Vlorë" }],
});

describe("employees", () => {
  it("lists for managers and admins, never for representatives, without password hashes", async () => {
    const m = await principalFor(MANAGER);
    const res = await listEmployees(m, employeeListQuery.parse({ role: "SALES_REPRESENTATIVE", pageSize: "50" }));
    expect(res.items.length).toBeGreaterThanOrEqual(2);
    expect(res.items.every((e) => e.user?.role === "SALES_REPRESENTATIVE")).toBe(true);
    expect(JSON.stringify(res)).not.toMatch(/passwordHash|\$2[aby]\$/);
    expect(await errorCode(listEmployees(await principalFor(REP_TIRANA)))).toBe("FORBIDDEN");
  });

  it("admins create an employee with a login account; managers cannot", async () => {
    const admin = await principalFor(ADMIN);
    const email = uniqueEmail();
    const e = await createEmployee(admin, { firstName: "Dea", lastName: "Kola", territory: "Durrës", account: { email, role: "SALES_REPRESENTATIVE", password: "a-long-initial-password" } });
    expect(e).toMatchObject({ name: "Dea Kola", territory: "Durrës", user: { email, role: "SALES_REPRESENTATIVE" } });
    expect(JSON.stringify(e)).not.toMatch(/passwordHash|a-long-initial-password/);
    resetLoginThrottle();
    expect(await verifyCredentials({ email, password: "a-long-initial-password" })).not.toBeNull();
    expect(await errorCode(createEmployee(admin, { firstName: "X", lastName: "Y", account: { email, role: "SALES_MANAGER", password: "another-password-1" } }))).toBe("DUPLICATE_EMAIL");
    expect(await errorCode(createEmployee(admin, { firstName: "X", lastName: "Y", account: { email: uniqueEmail(), role: "SALES_MANAGER", password: "short" } }))).toBe("VALIDATION_FAILED");
    expect(await errorCode(createEmployee(await principalFor(MANAGER), { firstName: "No", lastName: "Access" }))).toBe("FORBIDDEN");
  });

  it("deactivation requires reassigning customers, then blocks sign-in", async () => {
    const admin = await principalFor(ADMIN);
    const email = uniqueEmail();
    const leaving = await createEmployee(admin, { firstName: "Leaving", lastName: "Rep", account: { email, role: "SALES_REPRESENTATIVE", password: "leaving-rep-password" } });
    const taking = await createEmployee(admin, { firstName: "Taking", lastName: "Over" });
    const c = await createCustomer(admin, customer(leaving.id));
    const order = await db().order.create({ data: { orderNumber: "T-EMP-" + Date.now(), customerId: c.id, salesRepId: leaving.id, currencyCode: "ALL", allPerUnit: "1" } });

    const sid = await createSession(leaving.user!.id);
    expect(await loadPrincipal(leaving.user!.id, sid)).not.toBeNull();
    expect(await errorCode(updateEmployee(admin, leaving.id, { isActive: false }))).toBe("EMPLOYEE_HAS_CUSTOMERS");
    const done = await updateEmployee(admin, leaving.id, { isActive: false, reassignCustomersTo: taking.id });
    expect(done.isActive).toBe(false);
    expect((await getEmployee(admin, taking.id)).assignedCustomers.map((x) => x.id)).toContain(c.id);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).salesRepId).toBe(leaving.id); // history kept
    expect(await loadPrincipal(done.user!.id, sid)).toBeNull(); // sign-in blocked from the next request
    expect((await db().authSession.findUniqueOrThrow({ where: { id: sid } })).revokedAt).toBeInstanceOf(Date); // and its sessions revoked
    expect(await errorCode(updateEmployee(admin, taking.id, { isActive: false, reassignCustomersTo: leaving.id }))).toBe("VALIDATION_FAILED"); // inactive target
  });

  it("nobody can deactivate themselves", async () => {
    const admin = await principalFor(ADMIN);
    expect(await errorCode(updateEmployee(admin, admin.employeeId!, { isActive: false }))).toBe("CANNOT_DEACTIVATE_SELF");
  });

  it("managers move selected customers between representatives", async () => {
    const admin = await principalFor(ADMIN);
    const m = await principalFor(MANAGER);
    const a = await createEmployee(admin, { firstName: "A", lastName: "Rep" });
    const b = await createEmployee(admin, { firstName: "B", lastName: "Rep" });
    const c1 = await createCustomer(m, customer(a.id));
    const c2 = await createCustomer(m, customer(a.id));
    expect(await reassignCustomers(m, a.id, { toEmployeeId: b.id, customerIds: [c1.id] })).toEqual({ moved: 1, toEmployeeId: b.id });
    expect((await getEmployee(m, a.id)).assignedCustomers.map((x) => x.id)).toEqual([c2.id]);
    expect(await errorCode(reassignCustomers(await principalFor(REP_TIRANA), a.id, { toEmployeeId: b.id }))).toBe("FORBIDDEN");
    expect(await errorCode(reassignCustomers(m, a.id, { toEmployeeId: a.id }))).toBe("VALIDATION_FAILED");
  });
});
