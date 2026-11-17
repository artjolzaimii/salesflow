import { describe, expect, it } from "vitest";
import { addAddress, addContact, createCustomer, customerListQuery, deleteAddress, deleteContact, getCustomer, listCustomers, updateAddress, updateContact, updateCustomer } from "@/server/services/customers";
import { db, errorCode, freshDigits, freshNipt, invalidFields, MANAGER, NIPT, principalFor, REP_KORCE, REP_TIRANA } from "../support/fixtures";

const base = (over: Record<string, unknown> = {}) => ({
  businessName: "Test Market " + Math.random().toString(36).slice(2, 7),
  nipt: freshNipt(),
  businessType: "GROCERY",
  businessSize: "SMALL",
  city: "Tiranë",
  contacts: [{ fullName: "Ana Test", jobTitle: "Owner", phone: "+355 69 000 0000" }],
  addresses: [{ street: "Rr. Test 1", city: "Tiranë", type: "DELIVERY", postalCode: "1001" }],
  ...over,
});

describe("customers: create and validate", () => {
  it("creates a customer with several contacts and addresses in one step", async () => {
    const m = await principalFor(MANAGER);
    const rep = await principalFor(REP_KORCE);
    const c = await createCustomer(
      m,
      base({
        nipt: ((d) => ` k ${d.slice(0, 4)} ${d.slice(4)} b `)(freshDigits()),
        businessType: "CAFE",
        assignedRepId: rep.employeeId,
        contacts: [{ fullName: "First" }, { fullName: "Second", isPrimary: true, email: "Second@Example.AL" }],
        addresses: [{ street: "A 1", city: "Korçë" }, { street: "B 2", city: "Korçë", type: "REGISTERED_OFFICE" }],
      }),
    );
    expect(c.nipt).toMatch(/^K\d{8}B$/); // normalised: spaces removed, upper case
    expect(c.businessType).toBe("CAFE");
    expect(c.assignedRep?.id).toBe(rep.employeeId);
    expect(c.contacts.map((x) => [x.fullName, x.isPrimary])).toEqual([["Second", true], ["First", false]]);
    expect(c.contacts[0].email).toBe("second@example.al");
    expect(c.addresses.filter((a) => a.isDefault)).toHaveLength(1);
    expect(c.addresses.map((a) => a.type)).toContain("REGISTERED_OFFICE");
  });

  it("rejects an invalid NIPT, missing contact and bad postal code with field paths", async () => {
    const m = await principalFor(MANAGER);
    expect(await invalidFields(createCustomer(m, base({ nipt: "12345678" })))).toContain("nipt");
    expect(await invalidFields(createCustomer(m, base({ contacts: [] })))).toContain("contacts");
    expect(await invalidFields(createCustomer(m, base({ addresses: [{ street: "x", city: "y", postalCode: "12" }] })))).toContain("addresses.0.postalCode");
    expect(await invalidFields(createCustomer(m, base({ businessType: "BAKERY" })))).toContain("businessType");
  });

  it("refuses a duplicate NIPT regardless of case and spacing", async () => {
    const m = await principalFor(MANAGER);
    const nipt = freshNipt();
    await createCustomer(m, base({ nipt }));
    expect(await errorCode(createCustomer(m, base({ nipt: nipt.toLowerCase().replace(/(\d{4})/, "$1 ") })))).toBe("DUPLICATE_NIPT");
    expect(await errorCode(createCustomer(m, base({ nipt: NIPT.marketAlba })))).toBe("DUPLICATE_NIPT");
  });

  it("refuses two primary contacts", async () => {
    const m = await principalFor(MANAGER);
    expect(await errorCode(createCustomer(m, base({ contacts: [{ fullName: "A", isPrimary: true }, { fullName: "B", isPrimary: true }] })))).toBe("VALIDATION_FAILED");
  });
});

describe("customers: ownership and permissions", () => {
  it("a representative's new customer is always assigned to them", async () => {
    const rep = await principalFor(REP_TIRANA);
    const c = await createCustomer(rep, base());
    expect(c.assignedRep?.id).toBe(rep.employeeId);
    const other = await principalFor(REP_KORCE);
    expect(await errorCode(createCustomer(rep, base({ assignedRepId: other.employeeId })))).toBe("FORBIDDEN");
    expect(await errorCode(createCustomer(rep, base({ status: "BLOCKED" })))).toBe("FORBIDDEN");
  });

  it("another representative cannot read, edit or extend the customer (404, not 403)", async () => {
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const c = await createCustomer(tirana, base());
    expect(await errorCode(getCustomer(korce, c.id))).toBe("NOT_FOUND");
    expect(await errorCode(updateCustomer(korce, c.id, { businessName: "Hijacked" }))).toBe("NOT_FOUND");
    expect(await errorCode(addContact(korce, c.id, { fullName: "Spy" }))).toBe("NOT_FOUND");
    expect(await errorCode(addAddress(korce, c.id, { street: "x", city: "y" }))).toBe("NOT_FOUND");
    expect((await listCustomers(korce, customerListQuery.parse({ q: c.nipt }))).total).toBe(0);
  });

  it("only managers reassign or block; reassignment keeps who sold past orders", async () => {
    const m = await principalFor(MANAGER);
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const c = await createCustomer(tirana, base());
    expect(await errorCode(updateCustomer(tirana, c.id, { assignedRepId: korce.employeeId }))).toBe("FORBIDDEN");
    expect(await errorCode(updateCustomer(tirana, c.id, { status: "BLOCKED" }))).toBe("FORBIDDEN");
    expect((await updateCustomer(tirana, c.id, { status: "INACTIVE", notes: "Closed for winter" })).status).toBe("INACTIVE");

    const order = await db().order.create({
      data: { orderNumber: "T-HIST-" + Date.now(), customerId: c.id, salesRepId: tirana.employeeId!, currencyCode: "ALL", allPerUnit: "1", status: "DRAFT" },
    });
    const moved = await updateCustomer(m, c.id, { assignedRepId: korce.employeeId });
    expect(moved.assignedRep?.id).toBe(korce.employeeId);
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).salesRepId).toBe(tirana.employeeId);
    expect(await errorCode(updateCustomer(m, c.id, { assignedRepId: "00000000-0000-4000-8000-000000000000" }))).toBe("VALIDATION_FAILED");
  });

  it("customers cannot be deleted through the service layer (no such operation)", async () => {
    const mod = await import("@/server/services/customers");
    expect(Object.keys(mod).some((k) => /delete.*customer/i.test(k))).toBe(false);
  });
});

describe("customers: search, filters, sorting, pagination", () => {
  it("searches by name, NIPT fragment and city", async () => {
    const m = await principalFor(MANAGER);
    expect((await listCustomers(m, customerListQuery.parse({ q: "liqeni" }))).items.map((c) => c.nipt)).toEqual([NIPT.liqeni]);
    expect((await listCustomers(m, customerListQuery.parse({ q: "l3456" }))).items.map((c) => c.nipt)).toContain(NIPT.liqeni);
    expect((await listCustomers(m, customerListQuery.parse({ q: "Pogradec" }))).items.length).toBeGreaterThan(0);
  });

  it("filters by status and business type", async () => {
    const m = await principalFor(MANAGER);
    const cafe = await createCustomer(m, base({ businessType: "CAFE", status: "INACTIVE" }));
    const res = await listCustomers(m, customerListQuery.parse({ businessType: "CAFE", status: "INACTIVE" }));
    expect(res.items.map((c) => c.id)).toContain(cafe.id);
    expect(res.items.every((c) => c.businessType === "CAFE" && c.status === "INACTIVE")).toBe(true);
  });

  it("paginates with stable totals and sorts by allowlisted fields only", async () => {
    const m = await principalFor(MANAGER);
    const all = await listCustomers(m, customerListQuery.parse({ pageSize: "100", sort: "nipt" }));
    const p1 = await listCustomers(m, customerListQuery.parse({ pageSize: "2", page: "1", sort: "nipt" }));
    const p2 = await listCustomers(m, customerListQuery.parse({ pageSize: "2", page: "2", sort: "nipt" }));
    expect(p1.total).toBe(all.total);
    expect(p1.pages).toBe(Math.ceil(all.total / 2));
    expect([...p1.items, ...p2.items].map((c) => c.nipt)).toEqual(all.items.slice(0, 4).map((c) => c.nipt));
    const desc = await listCustomers(m, customerListQuery.parse({ pageSize: "100", sort: "nipt", dir: "desc" }));
    expect(desc.items.map((c) => c.nipt)).toEqual([...all.items.map((c) => c.nipt)].reverse());
    expect(customerListQuery.safeParse({ sort: "passwordHash" }).success).toBe(false);
    expect(customerListQuery.safeParse({ pageSize: "1000" }).success).toBe(false);
  });
});

describe("customers: contacts and addresses", () => {
  it("keeps exactly one primary contact", async () => {
    const m = await principalFor(MANAGER);
    const c = await createCustomer(m, base());
    const first = c.contacts[0];
    const second = await addContact(m, c.id, { fullName: "New Primary", isPrimary: true });
    const after = await getCustomer(m, c.id);
    expect(after.contacts.filter((x) => x.isPrimary).map((x) => x.id)).toEqual([second.id]);
    expect(await errorCode(deleteContact(m, c.id, second.id))).toBe("PRIMARY_CONTACT");
    expect(await errorCode(updateContact(m, c.id, second.id, { isPrimary: false }))).toBe("VALIDATION_FAILED");
    await updateContact(m, c.id, first.id, { isPrimary: true, jobTitle: "Buyer" });
    await deleteContact(m, c.id, second.id);
    const final = await getCustomer(m, c.id);
    expect(final.contacts).toHaveLength(1);
    expect(final.contacts[0]).toMatchObject({ id: first.id, isPrimary: true, jobTitle: "Buyer" });
  });

  it("protects the default address and addresses used by orders; edits keep order snapshots", async () => {
    const m = await principalFor(MANAGER);
    const alba = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba }, include: { addresses: true } });
    const used = alba.addresses[0]; // SO-2026-001 was delivered here
    expect(await errorCode(deleteAddress(m, alba.id, used.id))).toBe("DEFAULT_ADDRESS");
    const extra = await addAddress(m, alba.id, { street: "Depo 2", city: "Tiranë", isDefault: true });
    expect(await errorCode(deleteAddress(m, alba.id, used.id))).toBe("ADDRESS_IN_USE");

    const order = await db().order.findUniqueOrThrow({ where: { orderNumber: "SO-2026-001" } });
    await updateAddress(m, alba.id, used.id, { street: "Rruga e Re 99" });
    expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).deliverySnapshot).toEqual(order.deliverySnapshot);

    // restore
    await updateAddress(m, alba.id, used.id, { street: used.street, isDefault: true });
    await deleteAddress(m, alba.id, extra.id);
  });

  it("shows the customer's real order, invoice and payment history read-only", async () => {
    const m = await principalFor(MANAGER);
    const alba = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba } });
    const c = await getCustomer(m, alba.id);
    expect(c.history.orders.map((o) => o.orderNumber)).toContain("SO-2026-001");
    const inv = c.history.invoices.find((i) => i.invoiceNumber === "INV-2026-001")!;
    expect(inv).toMatchObject({ total: "4296.00", paid: "3920.00", outstanding: "376.00" });
    expect(c.history.payments.length).toBeGreaterThanOrEqual(2);
  });
});
