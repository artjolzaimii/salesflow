import { describe, expect, it } from "vitest";
import { cancelInvoice, issueReplacementInvoice } from "@/server/services/invoices";
import { changeOrderStatus, getOrder } from "@/server/services/orders";
import { recordPayment } from "@/server/services/payments";
import { positiveAmount } from "@/server/domain/money";
import { db, dbError, errorCode, invoicedOrder, invoiceOrder, key, MANAGER, NIPT, principalFor } from "../support/fixtures";

const dates = { issueDate: new Date("2026-11-05T00:00:00Z"), dueDate: new Date("2026-12-05T00:00:00Z") };
const pay = (invoiceId: string, amount: string) => ({ invoiceId, amount: positiveAmount.parse(amount), paymentDate: new Date(), method: "CASH" as const, idempotencyKey: key() });

describe("invoice cancellation", () => {
  it("keeps the cancelled invoice with reason, time and user", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, invoice.id, "Wrong customer address");
    const row = await db().invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(row).toMatchObject({ status: "CANCELLED", cancellationReason: "Wrong customer address", cancelledById: m.userId, total: invoice.total });
    expect(row.cancelledAt).toBeInstanceOf(Date);
  });

  it("refuses to cancel an invoice that has payments", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await recordPayment(m, pay(invoice.id, "1.00"));
    expect(await errorCode(cancelInvoice(m, invoice.id, "Customer disputes it"))).toBe("INVOICE_HAS_PAYMENTS");
    expect(await dbError(db().invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "x" } }))).toBe("Cannot cancel invoice with payments");
  });

  it("makes cancellation final and requires a reason", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    expect(await dbError(db().invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } }))).toContain("invoices_cancellation_fields");
    await cancelInvoice(m, invoice.id, "Duplicate");
    expect(await errorCode(cancelInvoice(m, invoice.id, "Again"))).toBe("INVOICE_CANCELLED");
    expect(await dbError(db().invoice.update({ where: { id: invoice.id }, data: { status: "ISSUED", cancelledAt: null, cancellationReason: null, cancelledById: null } }))).toBe("Cancelled invoice is final");
    expect(await dbError(db().invoice.delete({ where: { id: invoice.id } }))).toBe("Invoices cannot be deleted");
  });

  it("does not accept payments on a cancelled invoice", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, invoice.id, "Duplicate");
    expect(await errorCode(recordPayment(m, pay(invoice.id, "1.00")))).toBe("INVOICE_NOT_PAYABLE");
  });

  it("a payment and a cancellation racing each other: exactly one wins", async () => {
    const m = await principalFor(MANAGER);
    for (let i = 0; i < 5; i++) {
      const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
      const [p, c] = await Promise.allSettled([recordPayment(m, pay(invoice.id, "1.00")), cancelInvoice(m, invoice.id, "Race test")]);
      const row = await db().invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
      expect([p.status, c.status].filter((s) => s === "fulfilled")).toHaveLength(1);
      if (row.status === "CANCELLED") expect(row.payments).toHaveLength(0);
      else expect(row.payments).toHaveLength(1);
    }
  });
});

describe("replacement invoices", () => {
  it("only replaces a cancelled invoice, copying the locked snapshot", async () => {
    const m = await principalFor(MANAGER);
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca, currency: "USD", rate: "90", lines: [{ sku: "FOD-002", qty: "40" }] });
    expect(await errorCode(issueReplacementInvoice(m, invoice.id, dates))).toBe("INVOICE_NOT_CANCELLED");

    await cancelInvoice(m, invoice.id, "Wrong due date");
    expect((await getOrder(m, order.id)).invoiced).toBe(false);
    const repl = await issueReplacementInvoice(m, invoice.id, dates);
    expect(repl).toMatchObject({ invoiceNumber: invoice.invoiceNumber + "-R1", status: "ISSUED", currencyCode: "USD", replacesInvoiceId: invoice.id });
    expect(repl.total.eq(invoice.total)).toBe(true);
    const view = await getOrder(m, order.id);
    expect(view.invoiced).toBe(true);
    expect(view.invoiceHistory.map((i) => i.status)).toEqual(["CANCELLED", "ISSUED"]);
  });

  it("cannot replace the same invoice twice, or bypass via the database", async () => {
    const m = await principalFor(MANAGER);
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, invoice.id, "Typo");
    await issueReplacementInvoice(m, invoice.id, dates);
    expect(await errorCode(issueReplacementInvoice(m, invoice.id, dates))).toBe("ALREADY_REPLACED");
    // A second ISSUED invoice for the order is impossible even without the service.
    expect(await dbError(invoiceOrder(order.id))).toBe("Order already has an issued invoice");
  });

  it("requires the replacement to reference the cancelled invoice of the same order", async () => {
    const m = await principalFor(MANAGER);
    const a = await invoicedOrder({ nipt: NIPT.hotelKorca });
    const b = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, a.invoice.id, "Typo");
    expect(await dbError(invoiceOrder(a.order.id))).toBe("Replacement invoice must reference the cancelled invoice it replaces");
    await cancelInvoice(m, b.invoice.id, "Typo");
    expect(await dbError(invoiceOrder(a.order.id, { replaces: b.invoice.id }))).toBe("Replacement must reference a cancelled invoice of the same order");
  });

  it("concurrent replacements of one cancelled invoice: exactly one succeeds", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, invoice.id, "Typo");
    const r = await Promise.allSettled([1, 2, 3].map(() => issueReplacementInvoice(m, invoice.id, dates)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("is not possible once the order itself is cancelled", async () => {
    const m = await principalFor(MANAGER);
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca });
    await cancelInvoice(m, invoice.id, "Order withdrawn");
    await changeOrderStatus(m, order.id, "CANCELLED");
    expect(await errorCode(issueReplacementInvoice(m, invoice.id, dates))).toBe("ORDER_NOT_INVOICEABLE");
  });
});
