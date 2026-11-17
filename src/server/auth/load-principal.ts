import "server-only";
import { getDb } from "@/server/db";
import type { Principal } from "./principal";

/**
 * Loads the caller from the database. Returns null for an unknown user, a
 * disabled user or a disabled employee record, so those sessions stop working
 * on the next request.
 */
export async function loadPrincipal(userId: string): Promise<Principal | null> {
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, isActive: true, employee: { select: { id: true, isActive: true, firstName: true, lastName: true } } },
  });
  if (!user || !user.isActive || (user.employee && !user.employee.isActive)) return null;
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employee?.id ?? null,
    name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email,
  };
}
