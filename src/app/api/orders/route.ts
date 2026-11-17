import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { createOrder, listOrders, orderListQuery } from "@/server/services/orders";

/** GET ?q&status(|INVOICED)&currency&customerId&repId&from&to&page&pageSize&sort&dir — scoped to the caller. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listOrders(p, orderListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/** POST { customerId, salesRepId?, orderDate, currencyCode, deliveryAddressId?, lines[], status? } — priced on the server. 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ order: await createOrder(p, await readJson(req, z.unknown())) }, 201);
});
