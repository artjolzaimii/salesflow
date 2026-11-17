import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { searchParamsObject } from "@/server/query";
import { listPayments, paymentListQuery, recordPayment, recordPaymentSchema } from "@/server/services/payments";

/** GET ?q&method&currency&invoiceId&customerId&from&to&page&pageSize&sort&dir — scoped to the caller. */
export const GET = route(async (req) => {
  const p = await requireUser();
  return json(await listPayments(p, paymentListQuery.parse(searchParamsObject(req.nextUrl.searchParams))));
});

/**
 * POST { invoiceId, amount: "123.45", paymentDate, method, reference?, currencyCode?, idempotencyKey }
 * 201 for a new payment, 200 when the idempotency key replays an earlier one.
 */
export const POST = route(async (req) => {
  const p = await requireUser();
  const input = await readJson(req, recordPaymentSchema);
  const result = await recordPayment(p, input);
  return json(result, result.replayed ? 200 : 201);
});
