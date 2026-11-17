import "server-only";
import { hash } from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { USER_ROLES } from "@/lib/permissions";
import { employeeCreateSchema, employeePatchSchema, reassignSchema } from "@/lib/schemas/employees";
import { PASSWORD_HASH_COST } from "@/server/auth/credentials";
import { assertPermission, hasPermission, type Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { D } from "@/server/domain/money";
import { passwordProblem } from "@/lib/password-policy";
import { audit } from "@/server/audit";
import { revokeUserSessions } from "@/server/auth/sessions";
import { conflict, forbidden, invalid, mapDatabaseError, notFound } from "@/server/errors";
import { boolParam, listQuery, paged, skipTake } from "@/server/query";

export const employeeListQuery = listQuery(["lastName", "firstName", "createdAt", "territory"] as const, "lastName").extend({
  active: boolParam.optional(),
  role: z.enum(USER_ROLES).optional(),
});
export type EmployeeListQuery = z.output<typeof employeeListQuery>;

/** Never selects the password hash. */
const USER_PUBLIC = { select: { id: true, email: true, role: true, isActive: true } } as const;

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * Employees with their customer counts and month-to-date activity (orders
 * placed, net invoiced in ALL at each invoice's stored rate).
 */
export async function listEmployees(p: Principal, query: EmployeeListQuery = employeeListQuery.parse({})) {
  assertPermission(p, "employees.view");
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      query.active === undefined ? {} : { isActive: query.active },
      query.role ? { user: { role: query.role } } : {},
      query.q
        ? {
            OR: [
              { firstName: { contains: query.q, mode: "insensitive" } },
              { lastName: { contains: query.q, mode: "insensitive" } },
              { territory: { contains: query.q, mode: "insensitive" } },
              { user: { email: { contains: query.q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.employee.findMany({
      where,
      orderBy: [{ [query.sort]: query.dir }, { id: "asc" }],
      ...skipTake(query.page, query.pageSize),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        territory: true,
        isActive: true,
        user: USER_PUBLIC,
        _count: { select: { assignedCustomers: true } },
      },
    }),
    db.employee.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  const since = monthStart();
  const [orderCounts, invoices] = await Promise.all([
    db.order.groupBy({ by: ["salesRepId"], where: { salesRepId: { in: ids }, orderDate: { gte: since }, status: { not: "CANCELLED" } }, _count: true }),
    db.invoice.findMany({
      where: { status: "ISSUED", issueDate: { gte: since }, order: { salesRepId: { in: ids } } },
      select: { taxableTotal: true, allPerUnit: true, order: { select: { salesRepId: true } } },
    }),
  ]);
  return paged(
    rows.map(({ _count, ...e }) => ({
      ...e,
      name: `${e.firstName} ${e.lastName}`,
      customerCount: _count.assignedCustomers,
      ordersThisMonth: orderCounts.find((o) => o.salesRepId === e.id)?._count ?? 0,
      netInvoicedAllThisMonth: invoices
        .filter((i) => i.order.salesRepId === e.id)
        .reduce((s, i) => s.plus(i.taxableTotal.mul(i.allPerUnit)), D(0))
        .toFixed(2),
    })),
    total,
    query.page,
    query.pageSize,
  );
}

export async function getEmployee(p: Principal, id: string) {
  assertPermission(p, "employees.view");
  const e = await getDb().employee.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      territory: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      user: USER_PUBLIC,
      assignedCustomers: { orderBy: { businessName: "asc" }, select: { id: true, businessName: true, nipt: true, city: true, status: true } },
      _count: { select: { orders: true } },
    },
  });
  if (!e) throw notFound("Employee");
  const { _count, ...rest } = e;
  return { ...rest, name: `${e.firstName} ${e.lastName}`, orderCount: _count.orders };
}

/**
 * Creates an employee, optionally with a login account in the same
 * transaction. Creating an account requires users.manage; the password is
 * bcrypt-hashed and never returned.
 */
export async function createEmployee(p: Principal, raw: unknown) {
  assertPermission(p, "employees.manage");
  const input = employeeCreateSchema.parse(raw);
  if (input.account && !hasPermission(p, "users.manage")) throw forbidden("Creating login accounts requires user administration rights.");
  const weak = input.account ? passwordProblem(input.account.password, { email: input.account.email, names: [input.firstName, input.lastName] }) : null;
  if (weak) throw invalid(weak, { "account.password": [weak] });
  const db = getDb();
  try {
    const created = await db.$transaction(async (tx) => {
      const user = input.account
        ? await tx.user.create({
            // The administrator chose this password, so the person must replace it at first sign-in.
            data: { email: input.account.email, role: input.account.role, passwordHash: await hash(input.account.password, PASSWORD_HASH_COST), mustChangePassword: true },
            select: { id: true },
          })
        : null;
      if (user) await audit(tx, { type: "USER_CREATED", actorUserId: p.userId, targetUserId: user.id, details: { role: input.account!.role, employeeLinked: true, initialPasswordSetByAdmin: true } });
      return tx.employee.create({
        data: { firstName: input.firstName, lastName: input.lastName, phone: input.phone, territory: input.territory, isActive: input.isActive, userId: user?.id },
        select: { id: true },
      });
    });
    return getEmployee(p, created.id);
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

/**
 * Updates an employee. Deactivating blocks their sign-in on the next request
 * (the session layer checks Employee.isActive). An employee who still has
 * assigned customers can only be deactivated together with a reassignment, so
 * no customer is left without a representative. Nobody can deactivate themselves.
 */
export async function updateEmployee(p: Principal, id: string, raw: unknown) {
  assertPermission(p, "employees.manage");
  const { reassignCustomersTo, ...data } = employeePatchSchema.parse(raw);
  const db = getDb();
  const current = await db.employee.findUnique({ where: { id }, select: { id: true, isActive: true, userId: true, _count: { select: { assignedCustomers: true } } } });
  if (!current) throw notFound("Employee");

  const deactivating = data.isActive === false && current.isActive;
  if (deactivating && current.userId === p.userId) throw conflict("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account.");
  if (deactivating && current._count.assignedCustomers && !reassignCustomersTo) {
    throw conflict("EMPLOYEE_HAS_CUSTOMERS", `Reassign this employee's ${current._count.assignedCustomers} customers before deactivating.`);
  }
  if (reassignCustomersTo) {
    assertPermission(p, "customers.assign");
    await assertActiveTarget(reassignCustomersTo, id);
  }

  await db.$transaction(async (tx) => {
    if (reassignCustomersTo) await tx.customer.updateMany({ where: { assignedRepId: id }, data: { assignedRepId: reassignCustomersTo } });
    await tx.employee.update({ where: { id }, data });
    // Deactivating the employee also deactivates their login (reactivation is a separate,
    // explicit step in User management) and ends every open session at once.
    if (deactivating && current.userId) {
      const account = await tx.user.findUniqueOrThrow({ where: { id: current.userId }, select: { role: true, isActive: true } });
      if (account.role === "ADMIN" && account.isActive) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${0x5f0003}::bigint)`;
        const others = await tx.user.count({ where: { id: { not: current.userId }, role: "ADMIN", isActive: true, OR: [{ employee: null }, { employee: { isActive: true } }] } });
        if (!others) throw conflict("LAST_ADMIN", "This employee's account is the last active administrator.");
      }
      if (account.isActive) await tx.user.update({ where: { id: current.userId }, data: { isActive: false } });
      const n = await revokeUserSessions(current.userId, { tx });
      await audit(tx, { type: "USER_DEACTIVATED", actorUserId: p.userId, targetUserId: current.userId, details: { via: "employee", sessionsRevoked: n } });
    }
  });
  return getEmployee(p, id);
}

async function assertActiveTarget(toId: string, fromId: string) {
  if (toId === fromId) throw invalid("Choose a different representative.");
  const target = await getDb().employee.findUnique({ where: { id: toId }, select: { isActive: true } });
  if (!target?.isActive) throw invalid("The target representative does not exist or is inactive.");
}

/**
 * Moves customers from one representative to another (all of them, or the
 * listed ones). Past orders keep their original sales representative.
 */
export async function reassignCustomers(p: Principal, fromEmployeeId: string, raw: unknown) {
  assertPermission(p, "customers.assign");
  const input = reassignSchema.parse(raw);
  const db = getDb();
  if (!(await db.employee.findUnique({ where: { id: fromEmployeeId }, select: { id: true } }))) throw notFound("Employee");
  await assertActiveTarget(input.toEmployeeId, fromEmployeeId);
  const res = await db.customer.updateMany({
    where: { assignedRepId: fromEmployeeId, ...(input.customerIds ? { id: { in: input.customerIds } } : {}) },
    data: { assignedRepId: input.toEmployeeId },
  });
  return { moved: res.count, toEmployeeId: input.toEmployeeId };
}
