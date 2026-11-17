import { describe, expect, it } from "vitest";
import { changeOrderStatus, getOrder } from "@/server/services/orders";
import { createOrder, db, dbError, errorCode, invoicedOrder, MANAGER, NIPT, principalFor } from "../support/fixtures";

describe("order operational status transitions", () => {
  it("moves an invoiced order CONFIRMED → PROCESSING → DELIVERED", async () => {
    const m = await principalFor(MANAGER);
    const { order } = await invoicedOrder({ nipt: NIPT.adriatik });
    expect((await changeOrderStatus(m, order.id, "PROCESSING")).status).toBe("PROCESSING");
    expect((await changeOrderStatus(m, order.id, "DELIVERED")).status).toBe("DELIVERED");
    const view = await getOrder(m, order.id);
    expect(view).toMatchObject({ status: "DELIVERED", invoiced: true });
  });

  it("derives 'invoiced' from an issued invoice rather than a status", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.adriatik });
    expect((await getOrder(m, order.id)).invoiced).toBe(false);
  });

  it("rejects invalid transitions in the service and in the database", async () => {
    const m = await principalFor(MANAGER);
    const { order } = await invoicedOrder({ nipt: NIPT.adriatik });
    expect(await errorCode(changeOrderStatus(m, order.id, "DELIVERED"))).toBe("INVALID_STATUS_TRANSITION"); // skips PROCESSING
    expect(await errorCode(changeOrderStatus(m, order.id, "DRAFT"))).toBe("INVALID_STATUS_TRANSITION");
    await changeOrderStatus(m, order.id, "PROCESSING");
    // Bypassing the service does not help: the trigger enforces the same table.
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } }))).toBe("Invalid order status transition: PROCESSING -> CONFIRMED");
  });

  it("cannot cancel an order while it has an issued invoice", async () => {
    const m = await principalFor(MANAGER);
    const { order } = await invoicedOrder({ nipt: NIPT.adriatik });
    expect(await errorCode(changeOrderStatus(m, order.id, "CANCELLED"))).toBe("ORDER_HAS_ISSUED_INVOICE");
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { status: "CANCELLED" } }))).toBe("Cannot cancel an order with an issued invoice");
  });

  it("allows DRAFT → CONFIRMED → CANCELLED for an uninvoiced order", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.adriatik, status: "DRAFT" });
    await changeOrderStatus(m, order.id, "CONFIRMED");
    expect((await changeOrderStatus(m, order.id, "CANCELLED")).status).toBe("CANCELLED");
    expect(await errorCode(changeOrderStatus(m, order.id, "CONFIRMED"))).toBe("INVALID_STATUS_TRANSITION");
  });

  it("new orders cannot be created in a later status", async () => {
    expect(await dbError(createOrder({ nipt: NIPT.adriatik, status: "DELIVERED" }))).toBe("New orders must start as DRAFT or CONFIRMED");
  });

  it("only one of two concurrent identical transitions applies", async () => {
    const m = await principalFor(MANAGER);
    const order = await createOrder({ nipt: NIPT.adriatik });
    const results = await Promise.allSettled([changeOrderStatus(m, order.id, "PROCESSING"), changeOrderStatus(m, order.id, "PROCESSING")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("protection of invoiced financial data", () => {
  it("locks totals, rate, currency, customer and rep after invoicing, even after status changes", async () => {
    const m = await principalFor(MANAGER);
    const { order } = await invoicedOrder({ nipt: NIPT.adriatik, currency: "EUR", rate: "100", lines: [{ sku: "DRK-002", qty: "30" }] });
    await changeOrderStatus(m, order.id, "PROCESSING");
    const locked = "Invoiced order is financially locked";
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { grandTotal: "1" } }))).toBe(locked);
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { allPerUnit: "101" } }))).toBe(locked);
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { currencyCode: "USD" } }))).toBe(locked);
    const other = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba } });
    expect(await dbError(db().order.update({ where: { id: order.id }, data: { customerId: other.id } }))).toBe(locked);
  });

  it("locks order items after invoicing, including after the invoice is cancelled", async () => {
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.adriatik });
    const item = await db().orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const msg = "Cannot change items of an invoiced order";
    expect(await dbError(db().orderItem.update({ where: { id: item.id }, data: { discountPercent: "50" } }))).toBe(msg);
    expect(await dbError(db().orderItem.delete({ where: { id: item.id } }))).toBe(msg);
    await db().invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "test" } });
    expect(await dbError(db().orderItem.update({ where: { id: item.id }, data: { quantity: "1" } }))).toBe(msg);
  });

  it("renders history from line snapshots, unaffected by later product edits", async () => {
    const m = await principalFor(MANAGER);
    const { order } = await invoicedOrder({ nipt: NIPT.adriatik, lines: [{ sku: "HYG-001", qty: "5" }] });
    const before = (await getOrder(m, order.id)).items[0];
    await db().product.update({ where: { sku: "HYG-001" }, data: { name: "Renamed soap", defaultNetAll: "999", vatRate: "6", unit: "box" } });
    try {
      const after = (await getOrder(m, order.id)).items[0];
      expect(after).toEqual(before);
      expect(after).toMatchObject({ name: "Sapun 100g", unit: "cope", unitNetPrice: "120", vatRate: "20" });
    } finally {
      await db().product.update({ where: { sku: "HYG-001" }, data: { name: "Sapun 100g", defaultNetAll: "120", vatRate: "20", unit: "cope" } });
    }
  });
});
