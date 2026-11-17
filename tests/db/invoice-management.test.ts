import { describe, expect, it } from "vitest";
import { businessDate } from "@/lib/business-date";
import { cancelInvoice, getInvoice, invoiceListQuery, issueInvoice, issueReplacementInvoice, listInvoices } from "@/server/services/invoices";
import { changeOrderStatus, confirmOrder, getOrder, updateOrder } from "@/server/services/orders";
import { getPayment, listPayments, paymentListQuery, recordPayment, recordPaymentSchema } from "@/server/services/payments";
import {
  createOrder,
  daysFromToday,
  db,
  dbError,
  errorCode,
  INVOICE_NUMBER,
  invoicedOrder,
  invoiceSeq,
  key,
  MANAGER,
  NIPT,
  principalFor,
  REP_KORCE,
  REP_TIRANA,
} from "../support/fixtures";

/** Phase 5D invoice issuance, numbering, cancellation, replacement and payments against the real database. */

const due = (days = 30) => ({ dueDate: new Date(daysFromToday(days) + "T00:00:00Z") });
const pay = (invoiceId: string, amount: string, extra: Record<string, unknown> = {}) =>
  recordPaymentSchema.parse({ invoiceId, amount, paymentDate: businessDate(), method: "BANK_TRANSFER", reference: "BKT-" + key().slice(-6), idempotencyKey: key(), ...extra });
const counter = async (year = Number(businessDate().slice(0, 4))) =>
  Number((await db().invoiceNumberCounter.findUnique({ where: { year } }))?.lastValue ?? 0);

describe("invoice issuance", () => {
  it("copies the order's financial snapshot, currency and stored rate", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.liqeni, currency: "EUR", rate: "97.5", lines: [{ sku: "DRK-001", qty: "7", discount: "12.5" }, { sku: "FOD-002", qty: "3" }] });
    const inv = await issueInvoice(m, order.id, due(15));
    const row = await db().invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row).toMatchObject({ orderId: order.id, currencyCode: "EUR", status: "ISSUED", replacesInvoiceId: null });
    for (const [a, b] of [
      [row.allPerUnit, order.allPerUnit],
      [row.subtotalNet, order.subtotalNet],
      [row.discountTotal, order.discountTotal],
      [row.taxableTotal, order.taxableTotal],
      [row.vatTotal, order.vatTotal],
      [row.total, order.grandTotal],
    ]) {
      expect(a.eq(b)).toBe(true);
    }
    expect(inv).toMatchObject({ issueDate: businessDate(), dueDate: daysFromToday(15), paymentStatus: "UNPAID", overdue: false, outstanding: order.grandTotal.toFixed(2) });
    expect(inv.invoiceNumber).toMatch(INVOICE_NUMBER);
    expect(inv.items).toHaveLength(2);
  });

  it("is never automatic: confirming an order issues no invoice", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.liqeni, status: "DRAFT" });
    await confirmOrder(m, order.id);
    expect(await db().invoice.count({ where: { orderId: order.id } })).toBe(0);
    expect((await getOrder(m, order.id)).actions.issueInvoice).toBe(true);
  });

  it("only from confirmed, processing or delivered orders", async () => {
    const m = await principalFor(MANAGER);
    const draft = await createOrder({ nipt: NIPT.liqeni, status: "DRAFT" });
    expect(await errorCode(issueInvoice(m, draft.id, due()))).toBe("ORDER_NOT_INVOICEABLE");
    const cancelled = await createOrder({ nipt: NIPT.liqeni });
    await changeOrderStatus(m, cancelled.id, "CANCELLED");
    expect(await errorCode(issueInvoice(m, cancelled.id, due()))).toBe("ORDER_NOT_INVOICEABLE");
    const delivered = await createOrder({ nipt: NIPT.liqeni });
    await changeOrderStatus(m, delivered.id, "PROCESSING");
    await changeOrderStatus(m, delivered.id, "DELIVERED");
    expect((await issueInvoice(m, delivered.id, due())).status).toBe("ISSUED");
  });

  it("validates the due date and the order version", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.liqeni });
    expect(await errorCode(issueInvoice(m, order.id, due(-1)))).toBe("VALIDATION_FAILED");
    expect(await errorCode(issueInvoice(m, order.id, due(400)))).toBe("VALIDATION_FAILED");
    expect(await errorCode(issueInvoice(m, order.id, { ...due(), version: "2020-01-01T00:00:00.000Z" }))).toBe("CONCURRENT_UPDATE");
    const view = await getOrder(m, order.id);
    expect((await issueInvoice(m, order.id, { ...due(0), version: view.version })).dueDate).toBe(businessDate());
  });

  it("prevents a second invoice; after cancellation only a replacement is allowed", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.liqeni });
    const first = await issueInvoice(m, order.id, due());
    expect(await errorCode(issueInvoice(m, order.id, due()))).toBe("ORDER_ALREADY_INVOICED");
    await cancelInvoice(m, first.id, "Wrong due date");
    expect(await errorCode(issueInvoice(m, order.id, due()))).toBe("REPLACEMENT_REQUIRED");
    expect((await getOrder(m, order.id)).actions.issueInvoice).toBe(false);
  });

  it("concurrent issuance for one order: exactly one invoice", async () => {
    const m = await principalFor(MANAGER);
    for (let round = 0; round < 3; round++) {
      const order = await createOrder({ nipt: NIPT.liqeni });
      const r = await Promise.allSettled(Array.from({ length: 6 }, () => issueInvoice(m, order.id, due())));
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      for (const x of r) if (x.status === "rejected") expect(x.reason.code).toBe("ORDER_ALREADY_INVOICED");
      expect(await db().invoice.count({ where: { orderId: order.id } })).toBe(1);
    }
  });
});

describe("invoice numbering", () => {
  it("is sequential per year and keeps numbers of cancelled invoices", async () => {
    const m = await principalFor(MANAGER);
    const before = await counter();
    const a = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    const b = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    expect(a.invoiceNumber).toBe(`INV-${businessDate().slice(0, 4)}-${String(before + 1).padStart(6, "0")}`);
    expect(invoiceSeq(b.invoiceNumber)).toBe(invoiceSeq(a.invoiceNumber) + 1);
    await cancelInvoice(m, a.id, "Customer asked for new terms");
    expect((await db().invoice.findUniqueOrThrow({ where: { id: a.id } })).invoiceNumber).toBe(a.invoiceNumber);
    const repl = await issueReplacementInvoice(m, a.id, due());
    expect(invoiceSeq(repl.invoiceNumber)).toBe(invoiceSeq(b.invoiceNumber) + 1);
    expect(await counter()).toBe(before + 3);
  });

  it("concurrent issuance for different orders: unique, consecutive numbers", async () => {
    const m = await principalFor(MANAGER);
    const orders = await Promise.all(Array.from({ length: 10 }, () => createOrder({ nipt: NIPT.hotelKorca })));
    const before = await counter();
    const issued = await Promise.all(orders.map((o) => issueInvoice(m, o.id, due())));
    const seqs = issued.map((i) => invoiceSeq(i.invoiceNumber)).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(10);
    expect(seqs).toEqual(Array.from({ length: 10 }, (_, i) => before + 1 + i));
  });

  it("a rolled-back issuance does not consume a number, and counters never move back", async () => {
    const m = await principalFor(MANAGER);
    const year = Number(businessDate().slice(0, 4));
    const before = await counter(year);
    await expect(
      db().$transaction(async (tx) => {
        await tx.$queryRaw`SELECT next_invoice_number(${year}::int)`;
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await counter(year)).toBe(before);
    const next = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    expect(invoiceSeq(next.invoiceNumber)).toBe(before + 1);
    expect(await dbError(db().invoiceNumberCounter.update({ where: { year }, data: { lastValue: 1 } }))).toBe("Invoice number counters only move forward");
    expect(await dbError(db().invoiceNumberCounter.delete({ where: { year } }))).toBe("Invoice number counters cannot be deleted");
  });
});

describe("financial snapshot immutability", () => {
  it("later catalogue, rate and order changes never alter an issued invoice", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.liqeni, currency: "USD", rate: "91.25", lines: [{ sku: "DRK-002", qty: "4" }] });
    const inv = await issueInvoice(m, order.id, due());
    const snapshot = JSON.stringify((await getInvoice(m, inv.id)).totals);

    const product = await db().product.findUniqueOrThrow({ where: { sku: "DRK-002" } });
    await db().product.update({ where: { id: product.id }, data: { defaultNetAll: product.defaultNetAll.mul(3) } });
    try {
      const after = await getInvoice(m, inv.id);
      expect(JSON.stringify(after.totals)).toBe(snapshot);
      expect(after.rateText).toBe("91.25"); // the stored rate, not today's USD rate
      const item = await db().orderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(after.items[0].unitNetPrice).toBe(item.unitNetPrice.toString()); // the sold price, not the new catalogue price
      expect(await errorCode(updateOrder(m, order.id, { customerId: order.customerId, orderDate: businessDate(), currencyCode: "USD", lines: [{ productId: product.id, quantity: "1" }], version: (await getOrder(m, order.id)).version }))).toBe("ORDER_FINANCIALLY_LOCKED");
      expect(await dbError(db().invoice.update({ where: { id: inv.id }, data: { total: "1.00", subtotalNet: "1.00", taxableTotal: "1.00", vatTotal: "0", discountTotal: "0" } }))).toBe("Issued invoice financial snapshot is immutable");
      expect(await dbError(db().invoice.update({ where: { id: inv.id }, data: { dueDate: new Date("2099-01-01T00:00:00Z") } }))).toBe("Issued invoice financial snapshot is immutable");
    } finally {
      await db().product.update({ where: { id: product.id }, data: { defaultNetAll: product.defaultNetAll } });
    }
  });
});

describe("cancellation and replacement", () => {
  it("records who cancelled, when and why; requires the permission", async () => {
    const m = await principalFor(MANAGER);
    const rep = await principalFor(REP_KORCE);
    const order = await createOrder({ nipt: NIPT.liqeni });
    const inv = await issueInvoice(m, order.id, due());
    expect(await errorCode(cancelInvoice(rep, inv.id, "Not mine to cancel"))).toBe("FORBIDDEN");
    await cancelInvoice(m, inv.id, "Wrong billing entity");
    const view = await getInvoice(m, inv.id);
    expect(view).toMatchObject({ status: "CANCELLED", paymentStatus: "CANCELLED", outstanding: "0.00", cancellation: { reason: "Wrong billing entity", by: expect.any(String) } });
    expect(view.actions).toMatchObject({ cancel: false, recordPayment: false, replace: true });
    expect(await errorCode(recordPayment(m, pay(inv.id, "1.00")))).toBe("INVOICE_NOT_PAYABLE");
  });

  it("cannot cancel once a payment is recorded", async () => {
    const m = await principalFor(MANAGER);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    await recordPayment(m, pay(inv.id, "1.00"));
    expect((await getInvoice(m, inv.id)).actions.cancel).toBe(false);
    expect(await errorCode(cancelInvoice(m, inv.id, "Too late"))).toBe("INVOICE_HAS_PAYMENTS");
  });

  it("a replacement keeps the snapshot, links both ways and can happen once", async () => {
    const m = await principalFor(MANAGER);
    const rep = await principalFor(REP_KORCE);
    const order = await createOrder({ nipt: NIPT.liqeni, currency: "EUR", rate: "100", lines: [{ sku: "DRK-002", qty: "9", discount: "5" }] });
    const inv = await issueInvoice(m, order.id, due());
    expect(await errorCode(issueReplacementInvoice(m, inv.id, due()))).toBe("INVOICE_NOT_CANCELLED");
    await cancelInvoice(m, inv.id, "Wrong due date");
    expect(await errorCode(issueReplacementInvoice(rep, inv.id, due()))).toBe("FORBIDDEN");
    const repl = await issueReplacementInvoice(m, inv.id, due(45));
    expect(repl).toMatchObject({ totals: inv.totals, rateText: inv.rateText, currencyCode: "EUR", dueDate: daysFromToday(45), replaces: { id: inv.id } });
    expect(repl.invoiceNumber).not.toBe(inv.invoiceNumber);
    expect((await getInvoice(m, inv.id)).replacedBy).toMatchObject({ id: repl.id, invoiceNumber: repl.invoiceNumber });
    expect(await errorCode(issueReplacementInvoice(m, inv.id, due()))).toBe("ALREADY_REPLACED");
    // The replacement can itself be cancelled and replaced; the chain stays intact.
    await cancelInvoice(m, repl.id, "Second correction");
    const third = await issueReplacementInvoice(m, repl.id, due());
    expect((await getOrder(m, order.id)).invoiceHistory.map((i) => i.status)).toEqual(["CANCELLED", "CANCELLED", "ISSUED"]);
    expect(third.replaces?.id).toBe(repl.id);
  });
});

describe("payments and derived status", () => {
  it("partial then full payment: status, outstanding and history", async () => {
    const m = await principalFor(MANAGER);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni, lines: [{ sku: "DRK-001", qty: "10" }] })).id, due()); // 960.00 ALL
    expect(inv.totals.grandTotal).toBe("960.00");
    await recordPayment(m, pay(inv.id, "300.00"));
    let view = await getInvoice(m, inv.id);
    expect(view).toMatchObject({ paid: "300.00", outstanding: "660.00", paymentStatus: "PARTIALLY_PAID", overdue: false });
    expect(await errorCode(recordPayment(m, pay(inv.id, "660.01")))).toBe("OVERPAYMENT");
    await recordPayment(m, pay(inv.id, "660.00", { method: "CASH", reference: undefined }));
    view = await getInvoice(m, inv.id);
    expect(view).toMatchObject({ paid: "960.00", outstanding: "0.00", paymentStatus: "PAID" });
    expect(view.payments.map((p) => p.balanceAfter)).toEqual(["660.00", "0.00"]);
    expect(view.actions.recordPayment).toBe(false);
    expect(await errorCode(recordPayment(m, pay(inv.id, "0.01")))).toBe("OVERPAYMENT");
  });

  it("rejects the wrong currency, sub-cent amounts and impossible dates", async () => {
    const m = await principalFor(MANAGER);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni, currency: "EUR", rate: "100" })).id, due());
    expect(await errorCode(recordPayment(m, pay(inv.id, "1.00", { currencyCode: "ALL" })))).toBe("VALIDATION_FAILED");
    expect(await errorCode(Promise.resolve().then(() => pay(inv.id, "1.005")))).toBe("VALIDATION_FAILED");
    expect(await errorCode(Promise.resolve().then(() => pay(inv.id, "-1")))).toBe("VALIDATION_FAILED");
    expect(await errorCode(recordPayment(m, pay(inv.id, "1.00", { paymentDate: daysFromToday(1) })))).toBe("VALIDATION_FAILED");
    expect(await errorCode(recordPayment(m, pay(inv.id, "1.00", { paymentDate: daysFromToday(-1) })))).toBe("VALIDATION_FAILED"); // before issue
    const ok = await recordPayment(m, pay(inv.id, "1.00", { currencyCode: "EUR" }));
    expect(ok.payment).toMatchObject({ amount: "1.00", currencyCode: "EUR" });
  });

  it("an overdue invoice with partial payments is both overdue and partially paid", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca, issueDate: daysFromToday(-40), dueDate: daysFromToday(-10) });
    await recordPayment(m, pay(invoice.id, "10.00"));
    const view = await getInvoice(m, invoice.id);
    expect(view).toMatchObject({ paymentStatus: "PARTIALLY_PAID", overdue: true, daysOverdue: 10 });
    const ids = async (status: string) =>
      (await listInvoices(m, invoiceListQuery.parse({ status, customerId: (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.hotelKorca } })).id, pageSize: 100 }))).items.map((i) => i.id);
    expect(await ids("OVERDUE")).toContain(invoice.id);
    expect(await ids("PARTIALLY_PAID")).toContain(invoice.id);
    expect(await ids("OPEN")).toContain(invoice.id);
    expect(await ids("UNPAID")).not.toContain(invoice.id);
    expect(await ids("PAID")).not.toContain(invoice.id);
    // Due today is not overdue yet.
    const dueToday = await invoicedOrder({ nipt: NIPT.hotelKorca, issueDate: daysFromToday(-5), dueDate: daysFromToday(0) });
    expect((await getInvoice(m, dueToday.invoice.id)).overdue).toBe(false);
  });

  it("lists payments with per-currency totals, and payment detail with balances", async () => {
    const m = await principalFor(MANAGER);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    const p1 = await recordPayment(m, pay(inv.id, "100.00", { reference: "LIST-REF-1" }));
    await recordPayment(m, pay(inv.id, "50.00"));
    const page = await listPayments(m, paymentListQuery.parse({ invoiceId: inv.id }));
    expect(page.total).toBe(2);
    expect(page.totals).toEqual([{ currencyCode: "ALL", count: 2, amount: "150.00" }]);
    expect(page.items[0]).toMatchObject({ invoiceNumber: inv.invoiceNumber, customer: { businessName: expect.any(String) } });
    const found = await listPayments(m, paymentListQuery.parse({ q: "list-ref-1" }));
    expect(found.items.map((x) => x.id)).toContain(p1.payment.id);
    const detail = await getPayment(m, p1.payment.id);
    expect(detail).toMatchObject({ balanceBefore: inv.totals.grandTotal, invoice: { id: inv.id, paid: "150.00" } });
    expect(await dbError(db().payment.update({ where: { id: p1.payment.id }, data: { amount: "1.00" } }))).toBe("Payments cannot be edited; use reversal workflow");
    expect(await dbError(db().payment.delete({ where: { id: p1.payment.id } }))).toBe("Payments cannot be deleted; use reversal workflow");
  });
});

describe("authorization and scope", () => {
  it("representatives view their scope only and cannot issue or record payments", async () => {
    const m = await principalFor(MANAGER);
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const own = await createOrder({ nipt: NIPT.marketAlba });
    const inv = await issueInvoice(m, own.id, due());
    const payment = await recordPayment(m, pay(inv.id, "5.00"));
    const foreign = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());

    expect(await errorCode(issueInvoice(tirana, (await createOrder({ nipt: NIPT.marketAlba })).id, due()))).toBe("FORBIDDEN");
    expect(await errorCode(recordPayment(tirana, pay(inv.id, "1.00")))).toBe("FORBIDDEN");

    expect((await getInvoice(tirana, inv.id)).actions).toEqual({ recordPayment: false, cancel: false, replace: false });
    expect(await errorCode(getInvoice(korce, inv.id))).toBe("NOT_FOUND");
    expect(await errorCode(getInvoice(tirana, foreign.id))).toBe("NOT_FOUND");
    expect((await getPayment(tirana, payment.payment.id)).id).toBe(payment.payment.id);
    expect(await errorCode(getPayment(korce, payment.payment.id))).toBe("NOT_FOUND");

    const tiranaList = await listInvoices(tirana, invoiceListQuery.parse({ pageSize: 100 }));
    const ids = tiranaList.items.map((i) => i.id);
    expect(ids).toContain(inv.id);
    expect(ids).not.toContain(foreign.id);
    const tiranaPayments = await listPayments(tirana, paymentListQuery.parse({ pageSize: 100 }));
    expect(tiranaPayments.items.every((x) => x.customer.nipt !== NIPT.liqeni && x.customer.nipt !== NIPT.hotelKorca)).toBe(true);
    expect((await listInvoices(korce, invoiceListQuery.parse({ q: inv.invoiceNumber }))).total).toBe(0);
  });

  it("an unauthorized or unknown id looks the same (no existence leak)", async () => {
    const korce = await principalFor(REP_KORCE);
    const m = await principalFor(MANAGER);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.marketAlba })).id, due());
    const hidden = await errorCode(getInvoice(korce, inv.id));
    const missing = await errorCode(getInvoice(korce, crypto.randomUUID()));
    expect(hidden).toBe(missing);
  });

  it("list sorting is allowlisted, invoice numbers sort naturally", async () => {
    const m = await principalFor(MANAGER);
    expect(invoiceListQuery.safeParse({ sort: "invoice_number; DROP TABLE invoices" }).success).toBe(false);
    const asc = await listInvoices(m, invoiceListQuery.parse({ sort: "invoiceNumber", dir: "asc", q: "INV-", pageSize: 100 }));
    const nums = asc.items.map((i) => i.invoiceNumber).filter((n) => /^INV-\d{4}-\d+$/.test(n));
    const key2 = (n: string) => [n.slice(4, 8), Number(n.split("-")[2])] as const;
    const sorted = [...nums].sort((a, b) => (key2(a)[0] === key2(b)[0] ? key2(a)[1] - key2(b)[1] : key2(a)[0] < key2(b)[0] ? -1 : 1));
    expect(nums).toEqual(sorted);
    expect(nums[0]).toBe("INV-2026-001"); // seeded 3-digit numbers sort before the 6-digit ones
  });
});
