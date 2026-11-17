import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { changeOrderStatus, statusChangeSchema } from "@/server/services/orders";

/** POST { status: "CONFIRMED" | "PROCESSING" | "DELIVERED" | "CANCELLED", version? } */
export const POST = route<RouteContext<"/api/orders/[id]/status">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Order");
  const { status, version } = await readJson(req, statusChangeSchema);
  return json({ order: await changeOrderStatus(p, id, status, version) });
});
