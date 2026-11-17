import { requireUser } from "@/server/auth/session";
import { json, readJson, route, uuidParam } from "@/server/http";
import { changeOrderStatus, statusChangeSchema } from "@/server/services/orders";
import { notFound } from "@/server/errors";

/** POST { status: "PROCESSING" | "DELIVERED" | "CONFIRMED" | "CANCELLED" } */
export const POST = route<RouteContext<"/api/orders/[id]/status">>(async (req, ctx) => {
  const p = await requireUser();
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) throw notFound("Order");
  const { status } = await readJson(req, statusChangeSchema);
  return json({ order: await changeOrderStatus(p, id.data, status) });
});
