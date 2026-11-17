import { describe, expect, it } from "vitest";
import { loadPrincipal } from "@/server/auth/load-principal";
import { listCustomers } from "@/server/services/customers";
import { cancelInvoice } from "@/server/services/invoices";
import { changeOrderStatus, getOrder } from "@/server/services/orders";
import { recordPayment } from "@/server/services/payments";
import { positiveAmount } from "@/server/domain/money";
import { ADMIN, createOrder, db, errorCode, invoicedOrder, key, MANAGER, NIPT, principalFor, REP_KORCE, REP_TIRANA } from "../support/fixtures";

describe("role restrictions (server-side)", () => {
  it("representatives cannot record payments, cancel invoices or cancel orders", async () => {
    const rep = await principalFor(REP_TIRANA);
    const { order, invoice } = await invoicedOrder({ nipt: NIPT.marketAlba });
    expect(await errorCode(recordPayment(rep, { invoiceId: invoice.id, amount: positiveAmount.parse("1"), paymentDate: new Date(), method: "CASH", idempotencyKey: key() }))).toBe("FORBIDDEN");
    expect(await errorCode(cancelInvoice(rep, invoice.id, "test reason"))).toBe("FORBIDDEN");
    const draft = await createOrder({ nipt: NIPT.marketAlba, status: "DRAFT" });
    expect(await errorCode(changeOrderStatus(rep, draft.id, "CANCELLED"))).toBe("FORBIDDEN");
    // …but may move their own order forward.
    expect((await changeOrderStatus(rep, order.id, "PROCESSING")).status).toBe("PROCESSING");
  });

  it("managers and admins may cancel invoices and record payments", async () => {
    for (const email of [MANAGER, ADMIN]) {
      const p = await principalFor(email);
      const { invoice } = await invoicedOrder({ nipt: NIPT.liqeni });
      expect((await recordPayment(p, { invoiceId: invoice.id, amount: positiveAmount.parse("1"), paymentDate: new Date(), method: "CASH", idempotencyKey: key() })).replayed).toBe(false);
      const other = await invoicedOrder({ nipt: NIPT.liqeni });
      expect((await cancelInvoice(p, other.invoice.id, "Issued to the wrong branch")).status).toBe("CANCELLED");
    }
  });
});

describe("sales representative ownership", () => {
  it("lists only assigned customers", async () => {
    const tirana = (await listCustomers(await principalFor(REP_TIRANA))).map((c) => c.nipt).sort();
    const korce = (await listCustomers(await principalFor(REP_KORCE))).map((c) => c.nipt).sort();
    const manager = await listCustomers(await principalFor(MANAGER));
    expect(tirana).toEqual(["L12345678A", "L23456789B", "L56789012E"]);
    expect(korce).toEqual(["L34567890C", "L45678901D"]);
    expect(manager.length).toBe(5);
  });

  it("hides another rep's order as not found (no existence leak)", async () => {
    const korceOrder = await createOrder({ nipt: NIPT.liqeni });
    const tirana = await principalFor(REP_TIRANA);
    expect(await errorCode(getOrder(tirana, korceOrder.id))).toBe("NOT_FOUND");
    expect(await errorCode(changeOrderStatus(tirana, korceOrder.id, "PROCESSING"))).toBe("NOT_FOUND");
    expect((await getOrder(await principalFor(REP_KORCE), korceOrder.id)).orderNumber).toBe(korceOrder.orderNumber);
    expect((await getOrder(await principalFor(MANAGER), korceOrder.id)).orderNumber).toBe(korceOrder.orderNumber);
  });

  it("sees orders they sell even for a customer assigned to someone else", async () => {
    const order = await createOrder({ nipt: NIPT.liqeni });
    const tiranaEmp = (await principalFor(REP_TIRANA)).employeeId!;
    await db().order.update({ where: { id: order.id }, data: { salesRepId: tiranaEmp } });
    expect((await getOrder(await principalFor(REP_TIRANA), order.id)).id).toBe(order.id);
  });

  it("a representative without an employee record sees nothing", async () => {
    const rep = { ...(await principalFor(REP_TIRANA)), employeeId: null };
    expect(await listCustomers(rep)).toEqual([]);
  });

  it("the session loader re-reads role and active flags from the database", async () => {
    const id = (await principalFor(REP_KORCE)).userId;
    expect((await loadPrincipal(id))?.role).toBe("SALES_REPRESENTATIVE");
    await db().user.update({ where: { id }, data: { isActive: false } });
    expect(await loadPrincipal(id)).toBeNull();
    await db().user.update({ where: { id }, data: { isActive: true } });
  });
});
