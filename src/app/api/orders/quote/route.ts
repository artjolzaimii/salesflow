import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { quoteOrder } from "@/server/services/orders";

/** POST an order body (plus optional orderId when editing): server-priced lines and totals, nothing saved. */
export const POST = route(async (req) => {
  const p = await requireUser();
  return json({ quote: await quoteOrder(p, await readJson(req, z.unknown())) });
});
