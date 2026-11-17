import { Prisma } from "@/generated/prisma/client";
import { isScoped, type Principal } from "./principal";

/** Matches no row: used for a representative without an employee record. */
const NO_EMPLOYEE = "00000000-0000-0000-0000-000000000000";

/**
 * Record-level visibility as Prisma filters. Managers and admins see everything;
 * a sales representative sees:
 * - customers assigned to them (Customer.assignedRepId), and
 * - orders they sell (Order.salesRepId) or that belong to their customers,
 *   plus the invoices and payments of those orders.
 *
 * Services combine these with the requested id, so an out-of-scope record looks
 * exactly like a missing one (404), never a 403 that confirms it exists.
 */
export function customerScope(p: Principal): Prisma.CustomerWhereInput {
  if (!isScoped(p)) return {};
  return { assignedRepId: p.employeeId ?? NO_EMPLOYEE };
}

export function orderScope(p: Principal): Prisma.OrderWhereInput {
  if (!isScoped(p)) return {};
  const emp = p.employeeId ?? NO_EMPLOYEE;
  return { OR: [{ salesRepId: emp }, { customer: { assignedRepId: emp } }] };
}

export function invoiceScope(p: Principal): Prisma.InvoiceWhereInput {
  return isScoped(p) ? { order: orderScope(p) } : {};
}

export function paymentScope(p: Principal): Prisma.PaymentWhereInput {
  return isScoped(p) ? { invoice: invoiceScope(p) } : {};
}

/**
 * The order scope as a parameterized SQL condition, for aggregate queries that
 * Prisma's query API can't express (reports, invoice list). Expects the query to
 * alias orders as `o` and customers as `c`. Same rule as orderScope().
 */
export function orderScopeSql(p: Principal): Prisma.Sql {
  if (!isScoped(p)) return Prisma.sql`TRUE`;
  const emp = p.employeeId ?? NO_EMPLOYEE;
  return Prisma.sql`(o.sales_rep_id = ${emp}::uuid OR c.assigned_rep_id = ${emp}::uuid)`;
}
