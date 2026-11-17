import { requireUser } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { getInvoice } from "@/server/services/invoices";

/** GET — invoice with order snapshot, payment history, derived status and allowed actions. */
export const GET = route<RouteContext<"/api/invoices/[id]">>(async (_req, ctx) => {
  const p = await requireUser();
  return json({ invoice: await getInvoice(p, await idParam(ctx.params, "id", "Invoice")) });
});
