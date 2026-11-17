import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createRate, listRates, rateListQuery } from "@/server/services/exchange-rates";

/** GET ?currency&page&pageSize&sort&dir — history plus the current rate per currency. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listRates(p, rateListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST { currencyCode: "EUR" | "USD", allPerUnit: "97.80", effectiveAt: "2026-11-17" } — append-only, 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ rate: await createRate(p, await readJson(req, z.unknown())) }, 201);
});
