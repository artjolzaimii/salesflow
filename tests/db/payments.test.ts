import { describe, expect, it } from "vitest";
import { recordPayment, recordPaymentSchema } from "@/server/services/payments";
import { db, errorCode, invoicedOrder, key, MANAGER, NIPT, principalFor } from "../support/fixtures";

const input = (invoiceId: string, amount: string | number, extra: Record<string, unknown> = {}) =>
  recordPaymentSchema.parse({ invoiceId, amount, paymentDate: "2026-11-10", method: "BANK_TRANSFER", reference: "BKT-1", idempotencyKey: key(), ...extra });

const paidSum = async (invoiceId: string) =>
  (await db().payment.aggregate({ where: { invoiceId }, _sum: { amount: true } }))._sum.amount?.toFixed(2) ?? "0.00";

describe("payment validation", () => {
  it("rejects more than two decimal places instead of rounding", () => {
    const base = { invoiceId: crypto.randomUUID(), paymentDate: "2026-11-10", method: "CASH", idempotencyKey: key() };
    expect(recordPaymentSchema.safeParse({ ...base, amount: "10.005" }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, amount: 10.005 }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, amount: "10.01" }).success).toBe(true);
  });

  it("requires a reference for non-cash methods and an idempotency key", () => {
    const base = { invoiceId: crypto.randomUUID(), amount: "1", paymentDate: "2026-11-10" };
    expect(recordPaymentSchema.safeParse({ ...base, method: "BANK_TRANSFER", idempotencyKey: key() }).success).toBe(false);
    expect(recordPaymentSchema.safeParse({ ...base, method: "CASH", idempotencyKey: key() }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...base, method: "CASH" }).success).toBe(false);
  });

  it("records partial payments in the invoice currency and rejects a different currency", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni, currency: "EUR", rate: "100", lines: [{ sku: "DRK-002", qty: "10" }] }); // 18.00 EUR
    expect(invoice.total.toFixed(2)).toBe("18.00");
    const r = await recordPayment(m, input(invoice.id, "5.50"));
    expect(r.payment).toMatchObject({ amount: "5.50", currencyCode: "EUR" });
    expect(await errorCode(recordPayment(m, input(invoice.id, "1", { currencyCode: "ALL" })))).toBe("VALIDATION_FAILED");
    expect(await paidSum(invoice.id)).toBe("5.50");
  });

  it("rejects an overpayment without retrying it", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni }); // 960.00 ALL
    let retries = 0;
    expect(await errorCode(recordPayment(m, input(invoice.id, "960.01"), { onRetry: () => retries++ }))).toBe("OVERPAYMENT");
    expect(retries).toBe(0);
    await recordPayment(m, input(invoice.id, "960.00"));
    expect(await errorCode(recordPayment(m, input(invoice.id, "0.01")))).toBe("OVERPAYMENT");
  });
});

describe("idempotency", () => {
  it("returns the original payment when the same request is retried", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni });
    const req = input(invoice.id, "100.00");
    const first = await recordPayment(m, req);
    const again = await recordPayment(m, req);
    expect(again).toEqual({ payment: first.payment, replayed: true });
    expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });

  it("refuses to reuse a key for a different payment", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni });
    const req = input(invoice.id, "100.00");
    await recordPayment(m, req);
    expect(await errorCode(recordPayment(m, { ...req, amount: input(invoice.id, "200").amount }))).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("a burst of identical submissions creates exactly one payment", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni });
    const req = input(invoice.id, "10.00");
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => recordPayment(m, req)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof recordPayment>>>).value.payment.id));
    expect(ids.size).toBe(1);
    expect(await db().payment.count({ where: { invoiceId: invoice.id } })).toBe(1);
  });
});

describe("concurrent payment integrity", () => {
  it("two simultaneous full payments: one succeeds, the other is an overpayment", async () => {
    const m = await principalFor(MANAGER);
    for (let i = 0; i < 3; i++) {
      const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni });
      const total = invoice.total.toFixed(2);
      const r = await Promise.allSettled([recordPayment(m, input(invoice.id, total)), recordPayment(m, input(invoice.id, total))]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const rejected = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason.code).toBe("OVERPAYMENT");
      expect(await paidSum(invoice.id)).toBe(total);
    }
  });

  it("concurrent partial payments that fit all succeed (serialization conflicts are retried)", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni }); // 960.00
    let retries = 0;
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => recordPayment(m, input(invoice.id, "100.00"), { maxAttempts: 10, onRetry: () => retries++ })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(6);
    expect(await paidSum(invoice.id)).toBe("600.00");
    console.info(`  (${retries} serialization retries absorbed)`);
  });

  it("a burst that exceeds the total never overpays", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni }); // 960.00
    const r = await Promise.allSettled(Array.from({ length: 10 }, () => recordPayment(m, input(invoice.id, "150.00"), { maxAttempts: 10 })));
    const ok = r.filter((x) => x.status === "fulfilled").length;
    expect(ok).toBe(6); // 6 × 150 = 900 ≤ 960 < 1050
    for (const x of r) if (x.status === "rejected") expect(x.reason.code).toBe("OVERPAYMENT");
    expect(await paidSum(invoice.id)).toBe("900.00");
  });
});
