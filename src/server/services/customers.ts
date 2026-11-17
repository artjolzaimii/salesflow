import "server-only";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { customerScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";

/**
 * Customers visible to the caller (representatives: assigned customers only).
 * A thin read used to prove scoping end to end; the full customer module
 * (create, update, assign, contacts, addresses) is a later phase.
 */
export async function listCustomers(p: Principal) {
  assertPermission(p, "customers.view");
  const rows = await getDb().customer.findMany({
    where: customerScope(p),
    orderBy: { businessName: "asc" },
    select: { id: true, businessName: true, nipt: true, city: true, businessType: true, status: true, assignedRepId: true },
  });
  return rows;
}
