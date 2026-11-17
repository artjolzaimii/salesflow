import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { auditListQuery, listAuditEvents } from "@/server/services/users";

/** GET ?userId&type&page&pageSize&dir — the security audit log (administrators only). */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listAuditEvents(p, auditListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
