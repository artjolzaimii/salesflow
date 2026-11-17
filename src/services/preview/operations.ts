/**
 * In-memory stand-ins for backend mutations still in preview (payments).
 * Orders are database-backed since Phase 5C (src/server/services/orders.ts).
 *
 * Each function is pure: it takes the current dataset and returns a new one plus
 * the created/changed record. Production replaces these with the matching
 * `SalesFlowApi` calls (see ../api.ts), whose responses are authoritative,
 * including all totals, VAT and rounding.
 */
import type { Payment, SalesDataset } from "@/lib/types";
import type { CreatePaymentInput } from "../api";

const nextNumber = (ids: string[]) => Math.max(0, ...ids.map((id) => Number(id.slice(-4)))) + 1;
const pad4 = (n: number) => String(n).padStart(4, "0");

export function recordPayment(data: SalesDataset, input: CreatePaymentInput): { data: SalesDataset; payment: Payment } {
  const invoice = data.invoices.find((i) => i.id === input.invoiceId)!;
  const n = nextNumber(data.payments.map((p) => p.id));
  const payment: Payment = {
    id: "PAY-2026-" + pad4(n),
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    date: input.date,
    amount: input.amount,
    currency: invoice.currency,
    method: input.method,
    reference: input.reference.trim() || "ARK-" + (500000 + n),
  };
  return {
    payment,
    data: {
      ...data,
      invoices: data.invoices.map((i) => (i.id === invoice.id ? { ...i, paid: i.paid + input.amount } : i)),
      payments: [payment, ...data.payments],
    },
  };
}
