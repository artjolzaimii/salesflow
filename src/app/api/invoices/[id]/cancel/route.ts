import { requireUser } from "@/server/auth/session";
import { json, readJson, route, uuidParam } from "@/server/http";
import { cancelInvoice, cancelInvoiceSchema } from "@/server/services/invoices";
import { notFound } from "@/server/errors";

/** POST { reason } — cancels an ISSUED invoice that has no payments. */
export const POST = route<RouteContext<"/api/invoices/[id]/cancel">>(async (req, ctx) => {
  const p = await requireUser();
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) throw notFound("Invoice");
  const { reason } = await readJson(req, cancelInvoiceSchema);
  return json({ invoice: await cancelInvoice(p, id.data, reason) });
});
