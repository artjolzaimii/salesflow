import "server-only";
import { getDb } from "@/server/db";
import type { Principal } from "./principal";

/**
 * Loads the caller from the database in one query. Returns null unless the
 * session row exists for this user, is not revoked and has not expired, and the
 * user and their employee record are active. So sign-out, deactivation and the
 * absolute session lifetime all apply on the next request.
 */
export async function loadPrincipal(userId: string, sessionId: string): Promise<Principal | null> {
  const session = await getDb().authSession.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      user: { select: { id: true, email: true, role: true, isActive: true, employee: { select: { id: true, isActive: true, firstName: true, lastName: true } } } },
    },
  });
  const user = session?.user;
  if (!user || !user.isActive || (user.employee && !user.employee.isActive)) return null;
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employee?.id ?? null,
    name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email,
  };
}
