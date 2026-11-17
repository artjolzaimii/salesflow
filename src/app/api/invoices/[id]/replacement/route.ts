import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { idParam } from "@/server/route-params";
import { issueReplacementInvoice, replacementSchema } from "@/server/services/invoices";

/** POST { dueDate } — issues the replacement for a cancelled invoice (new number, same snapshot). 201. */
export const POST = route<RouteContext<"/api/invoices/[id]/replacement">>(async (req, ctx) => {
  const p = await requireUser();
  const id = await idParam(ctx.params, "id", "Invoice");
  const input = await readJson(req, replacementSchema);
  return json({ invoice: await issueReplacementInvoice(p, id, input) }, 201);
});
