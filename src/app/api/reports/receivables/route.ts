import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { receivablesReport, receivablesQuery } from "@/server/services/reports";

/** GET ?overdueOnly&basis&currency&customerId&page&pageSize — open invoices with aging, as of today. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await receivablesReport(p, receivablesQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
