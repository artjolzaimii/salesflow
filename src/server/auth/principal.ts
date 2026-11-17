import { can, isScopedRole, type Permission, type UserRole } from "@/lib/permissions";
import { makeClientUser, type ClientSessionUser } from "@/lib/session-user";
import { forbidden } from "@/server/errors";

/** The authenticated caller, as loaded from the database for this request. */
export interface Principal {
  userId: string;
  email: string;
  role: UserRole;
  /** Employee record linked to the user; reps without one can see no records. */
  employeeId: string | null;
  name: string;
  /** Server-side session (auth_sessions.id) this request belongs to. */
  sessionId?: string;
  /** An administrator set the password: it must be changed before anything else. */
  mustChangePassword?: boolean;
}

export function toClientUser(p: Principal): ClientSessionUser {
  return makeClientUser(p);
}

export function hasPermission(p: Principal, permission: Permission): boolean {
  return can(p.role, permission);
}

export function assertPermission(p: Principal, permission: Permission): void {
  if (!can(p.role, permission)) throw forbidden();
}

export function isScoped(p: Principal): boolean {
  return isScopedRole(p.role);
}
