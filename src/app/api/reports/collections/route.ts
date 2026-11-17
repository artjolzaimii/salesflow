import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { collectionsReport, collectionsQuery } from "@/server/services/reports";

/** GET ?period…&groupBy=trend|method|currency|customer&basis&page&pageSize — payments by payment date at the invoice rate. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await collectionsReport(p, collectionsQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
