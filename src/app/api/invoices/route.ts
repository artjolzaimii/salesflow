import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { invoiceListQuery, issueInvoice, issueInvoiceSchema, listInvoices } from "@/server/services/invoices";

/**
 * GET ?q&status(OPEN|UNPAID|PARTIALLY_PAID|PAID|OVERDUE|CANCELLED)&currency&customerId&orderId&from&to&page&pageSize&sort&dir
 * Scoped to the caller; payment status is derived from payments and the due date.
 */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listInvoices(p, invoiceListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

const issueBody = z.strictObject({ ...issueInvoiceSchema.shape, orderId: z.uuid() });

/** POST { orderId, dueDate, version? } — issues the first invoice of an eligible order (managers and admins). 201. */
export const POST = route(async (req) => {
  const p = await requireUser();
  const { orderId, ...input } = await readJson(req, issueBody);
  return json({ invoice: await issueInvoice(p, orderId, input) }, 201);
});
