import { describe, expect, it } from "vitest";
import { businessDate } from "@/lib/business-date";
import { cancelInvoice, getInvoice, issueInvoice, issueReplacementInvoice } from "@/server/services/invoices";
import { getPayment, listPayments, paymentListQuery, recordPayment, recordPaymentSchema } from "@/server/services/payments";
import { createOrder, daysFromToday, db, dbError, freshNipt, invoicedOrder, key, MANAGER, NIPT, principalFor, REP_KORCE } from "../support/fixtures";

/** Phase 5E audit fields: payment attribution and the invoice billing snapshot. */

const due = () => ({ dueDate: new Date(daysFromToday(30) + "T00:00:00Z") });
const pay = (invoiceId: string, amount: string) =>
  recordPaymentSchema.parse({ invoiceId, amount, paymentDate: businessDate(), method: "CASH", idempotencyKey: key() });

async function customerWithBilling() {
  const rep = await db().employee.findFirstOrThrow({ where: { user: { email: REP_KORCE } } });
  const nipt = freshNipt();
  const c = await db().customer.create({
    data: {
      businessName: "Snapshot Test " + nipt,
      nipt,
      businessType: "HOTEL",
      city: "Korce",
      assignedRepId: rep.id,
      addresses: {
        create: [
          { type: "DELIVERY", street: "Delivery Street 1", city: "Korce", isDefault: true },
          { type: "BILLING", label: "Head office", street: "Billing Street 9", city: "Korce", postalCode: "7001" },
        ],
      },
    },
    include: { addresses: true },
  });
  return { ...c, billing: c.addresses.find((a) => a.type === "BILLING")! };
}

describe("invoice billing snapshot", () => {
  it("records name, NIPT and billing address at issue; later edits don't change the invoice", async () => {
    const m = await principalFor(MANAGER);
    const c = await customerWithBilling();
    const inv = await issueInvoice(m, (await createOrder({ nipt: c.nipt })).id, due());
    const row = await db().invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row.billingAddressSnapshot).toMatchObject({ businessName: c.businessName, nipt: c.nipt, addressId: c.billing.id, type: "BILLING", street: "Billing Street 9", postalCode: "7001" });
    expect(inv.customer).toMatchObject({ billingAddress: "Billing Street 9, 7001 Korce", billingFromSnapshot: true });

    await db().customerAddress.update({ where: { id: c.billing.id }, data: { street: "Moved Street 77" } });
    await db().customer.update({ where: { id: c.id }, data: { businessName: c.businessName + " (renamed)" } });
    const after = await getInvoice(m, inv.id);
    expect(after.customer).toMatchObject({ billingAddress: "Billing Street 9, 7001 Korce", billedName: c.businessName });
    expect(await dbError(db().invoice.update({ where: { id: inv.id }, data: { billingAddressSnapshot: { businessName: "Forged" } } }))).toBe("Invoice billing snapshot is immutable");
  });

  it("a replacement keeps the cancelled invoice's snapshot; the database refuses a different one", async () => {
    const m = await principalFor(MANAGER);
    const c = await customerWithBilling();
    const inv = await issueInvoice(m, (await createOrder({ nipt: c.nipt })).id, due());
    await db().customerAddress.update({ where: { id: c.billing.id }, data: { street: "New Billing Street 2" } });
    await cancelInvoice(m, inv.id, "Reissue");
    const repl = await issueReplacementInvoice(m, inv.id, due());
    const [a, b] = await Promise.all([inv.id, repl.id].map((id) => db().invoice.findUniqueOrThrow({ where: { id } })));
    expect(b.billingAddressSnapshot).toEqual(a.billingAddressSnapshot);
    expect(repl.customer.billingAddress).toBe("Billing Street 9, 7001 Korce");

    await cancelInvoice(m, repl.id, "Second reissue");
    const o = await db().order.findUniqueOrThrow({ where: { id: b.orderId } });
    const forged = db().invoice.create({
      data: {
        invoiceNumber: "T-FORGE-" + key().slice(-8),
        orderId: o.id,
        replacesInvoiceId: repl.id,
        currencyCode: o.currencyCode,
        allPerUnit: o.allPerUnit,
        subtotalNet: o.subtotalNet,
        discountTotal: o.discountTotal,
        taxableTotal: o.taxableTotal,
        vatTotal: o.vatTotal,
        total: o.grandTotal,
        issueDate: new Date(businessDate() + "T00:00:00Z"),
        dueDate: new Date(daysFromToday(10) + "T00:00:00Z"),
        billingAddressSnapshot: { businessName: "Someone else" },
      },
    });
    expect(await dbError(forged)).toBe("Replacement must keep the billing snapshot of the invoice it replaces");
  });

  it("invoices from before snapshots stay valid and are never back-filled", async () => {
    const m = await principalFor(MANAGER);
    const { invoice } = await invoicedOrder({ nipt: NIPT.hotelKorca }); // inserted without a snapshot, like pre-5E invoices
    const view = await getInvoice(m, invoice.id);
    expect(view.customer.billingFromSnapshot).toBe(false);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).billingAddressSnapshot).toBeNull();
    // Its replacement is a new document: it records the billing details at the time it is issued.
    await cancelInvoice(m, invoice.id, "Legacy reissue");
    const repl = await issueReplacementInvoice(m, invoice.id, due());
    expect(repl.customer.billingFromSnapshot).toBe(true);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: invoice.id } })).billingAddressSnapshot).toBeNull();
    const seeded = await db().invoice.findUniqueOrThrow({ where: { invoiceNumber: "INV-2026-001" } });
    expect(seeded.billingAddressSnapshot).toBeNull();
  });
});

describe("payment attribution", () => {
  it("stores the recording user, immutably, and shows it to managers only", async () => {
    const m = await principalFor(MANAGER);
    const rep = await principalFor(REP_KORCE);
    const inv = await issueInvoice(m, (await createOrder({ nipt: NIPT.liqeni })).id, due());
    const { payment } = await recordPayment(m, pay(inv.id, "10.00"));
    expect((await db().payment.findUniqueOrThrow({ where: { id: payment.id } })).recordedByUserId).toBe(m.userId);
    expect(payment).toMatchObject({ recordedBy: "Elira Kola", recordedByKnown: true });
    expect((await getInvoice(m, inv.id)).payments[0].recordedBy).toBe("Elira Kola");
    expect((await getPayment(m, payment.id)).recordedBy).toBe("Elira Kola");

    expect((await getPayment(rep, payment.id)).recordedBy).toBeNull();
    expect((await getInvoice(rep, inv.id)).payments[0].recordedBy).toBeNull();
    const admin = await db().user.findUniqueOrThrow({ where: { email: "admin@salesflow.test" } });
    expect(await dbError(db().payment.update({ where: { id: payment.id }, data: { recordedByUserId: admin.id } }))).toBe("Payments cannot be edited; use reversal workflow");
  });

  it("historical payments without attribution remain valid and are not attributed", async () => {
    const m = await principalFor(MANAGER);
    const seeded = await db().payment.findFirstOrThrow({ where: { reference: "INV-2026-001-PAY-1" } });
    expect(seeded.recordedByUserId).toBeNull();
    const view = await getPayment(m, seeded.id);
    expect(view).toMatchObject({ recordedBy: null, recordedByKnown: false });
    const listed = await listPayments(m, paymentListQuery.parse({ q: "INV-2026-001-PAY-1" }));
    expect(listed.items[0]).toMatchObject({ recordedBy: null, recordedByKnown: false });
  });
});
