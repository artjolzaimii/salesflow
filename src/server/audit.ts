import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/server/db";

/**
 * Security audit log (security_audit_events, append-only by trigger). Details
 * are small, non-secret facts (old/new role, how many sessions were revoked);
 * passwords, MFA secrets, recovery codes and reset links are never recorded.
 */
export const AUDIT_EVENTS = [
  "USER_CREATED",
  "USER_ACTIVATED",
  "USER_DEACTIVATED",
  "ROLE_CHANGED",
  "EMPLOYEE_LINKED",
  "EMPLOYEE_UNLINKED",
  "SETUP_LINK_ISSUED",
  "PASSWORD_RESET_ISSUED",
  "PASSWORD_RESET_COMPLETED",
  "PASSWORD_CHANGED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "MFA_RESET_BY_ADMIN",
  "RECOVERY_CODES_REGENERATED",
  "RECOVERY_CODE_USED",
  "SESSION_REVOKED",
  "SESSIONS_REVOKED",
  "SESSIONS_REVOKED_BY_ADMIN",
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

type Db = Prisma.TransactionClient | ReturnType<typeof getDb>;

export async function audit(
  db: Db,
  event: { type: AuditEvent; actorUserId: string | null; targetUserId: string | null; details?: Record<string, string | number | boolean | null> },
) {
  await db.securityAuditEvent.create({
    data: { id: randomUUID(), eventType: event.type, actorUserId: event.actorUserId, targetUserId: event.targetUserId, details: event.details ?? {} },
  });
}
