import { requireUser } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { recordPayment, recordPaymentSchema } from "@/server/services/payments";

/**
 * POST { invoiceId, amount: "123.45", paymentDate, method, reference?, idempotencyKey }
 * 201 for a new payment, 200 when the idempotency key replays an earlier one.
 */
export const POST = route(async (req) => {
  const p = await requireUser();
  const input = await readJson(req, recordPaymentSchema);
  const result = await recordPayment(p, input);
  return json(result, result.replayed ? 200 : 201);
});
