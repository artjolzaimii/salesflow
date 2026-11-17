import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { salesBreakdown, salesReportQuery } from "@/server/services/reports";

/** GET ?period…&groupBy=trend|customer|product|category|rep|currency&basis=ALL_EQ|ALL|EUR|USD&page&pageSize — invoiced sales by issue date (revenue trend, customer, product, category and representative performance). */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await salesBreakdown(p, salesReportQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
