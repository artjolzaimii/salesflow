import { PERMISSIONS, can, type Permission } from "@/lib/permissions";
import { toClientUser } from "@/server/auth/principal";
import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";

/** The signed-in user and the permissions their role grants. 401 when signed out. */
export const GET = route(async () => {
  const p = await requireUser({ allowPendingPasswordChange: true });
  const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((k) => can(p.role, k));
  return json({ user: toClientUser(p), permissions, scopedToOwnCustomers: p.role === "SALES_REPRESENTATIVE", mustChangePassword: !!p.mustChangePassword });
});
