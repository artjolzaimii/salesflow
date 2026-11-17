import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { cancelInvoice, cancelInvoiceSchema } from "@/server/services/invoices";

/** POST { reason } — cancels an ISSUED invoice that has no payments. The record and its number are kept. */
export const POST = route<RouteContext<"/api/invoices/[id]/cancel">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Invoice");
  const { reason } = await readJson(req, cancelInvoiceSchema);
  return json({ invoice: await cancelInvoice(p, id, reason) });
});
