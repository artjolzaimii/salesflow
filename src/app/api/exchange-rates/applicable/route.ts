import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { applicableRateQuery, rateForOrderDate } from "@/server/services/exchange-rates";

/** GET ?currency=EUR&date=2026-11-17 — the rate an order on that date would snapshot (null + reason if none). */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await rateForOrderDate(p, applicableRateQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});
