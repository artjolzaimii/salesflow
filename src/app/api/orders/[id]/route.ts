import { requireUser } from "@/server/auth/session";
import { json, route, uuidParam } from "@/server/http";
import { getOrder } from "@/server/services/orders";
import { notFound } from "@/server/errors";

export const GET = route<RouteContext<"/api/orders/[id]">>(async (_req, ctx) => {
  const p = await requireUser();
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) throw notFound("Order");
  return json({ order: await getOrder(p, id.data) });
});
