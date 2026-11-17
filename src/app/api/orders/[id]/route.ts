import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getOrder, updateOrder } from "@/server/services/orders";

type Ctx = RouteContext<"/api/orders/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ order: await getOrder(p, await idParam(ctx.params, "id", "Order")) });
});

/** PATCH the full order body plus `version`; re-priced on the server. Draft and confirmed, never-invoiced orders only. */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Order");
  return json({ order: await updateOrder(p, id, await readJson(req, z.unknown())) });
});
