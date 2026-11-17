import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createProduct, listProducts, productListQuery } from "@/server/services/catalog";

/** GET ?q&categoryId&active&page&pageSize&sort&dir */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listProducts(p, productListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST { sku, name, categoryId, unit, defaultNetAll: "120.5", vatRate: "20", isActive } — 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ product: await createProduct(p, await readJson(req, z.unknown())) }, 201);
});
