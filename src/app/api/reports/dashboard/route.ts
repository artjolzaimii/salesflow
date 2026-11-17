import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { dashboardSummary, dashboardQuery } from "@/server/services/reports";

/** GET ?period=today|week|month|year|custom&from&to — dashboard figures in ALL (stored rates). Scoped to the caller. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await dashboardSummary(p, dashboardQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
