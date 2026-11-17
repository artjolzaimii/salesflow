import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { confirmOrder } from "@/server/services/orders";
import { confirmSchema } from "@/lib/schemas/orders";

/** POST { version? } — DRAFT → CONFIRMED with server re-pricing checks. */
export const POST = route<RouteContext<"/api/orders/[id]/confirm">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Order");
  const { version } = await readJson(req, confirmSchema);
  return json({ order: await confirmOrder(p, id, version) });
});
