import { requireUser } from "@/server/auth/session";
import { json, readJson, route, uuidParam } from "@/server/http";
import { issueReplacementInvoice, replacementSchema } from "@/server/services/invoices";
import { notFound } from "@/server/errors";

/** POST { issueDate, dueDate } — issues the replacement for a cancelled invoice. */
export const POST = route<RouteContext<"/api/invoices/[id]/replacement">>(async (req, ctx) => {
  const p = await requireUser();
  const id = uuidParam.safeParse((await ctx.params).id);
  if (!id.success) throw notFound("Invoice");
  const dates = await readJson(req, replacementSchema);
  const invoice = await issueReplacementInvoice(p, id.data, dates);
  return json({ invoice: { ...invoice, total: invoice.total.toFixed(2) } }, 201);
});
