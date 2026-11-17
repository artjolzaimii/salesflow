import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getPayment } from "@/server/services/payments";

/** GET — one payment with its invoice and the balance before and after it. */
export const GET = route<RouteContext<"/api/payments/[id]">>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ payment: await getPayment(p, await idParam(ctx.params, "id", "Payment")) });
});
