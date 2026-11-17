import { beforeAll, describe, expect, it } from "vitest";
import { listOrders, orderListQuery, changeOrderStatus, confirmOrder, createOrder, getOrder, quoteOrder, updateOrder } from "@/server/services/orders";
import { reassignCustomers } from "@/server/services/employees";
import {
  createOrder as fixtureOrder,
  db,
  errorCode,
  freshNipt,
  invalidFields,
  invoiceOrder,
  MANAGER,
  NIPT,
  principalFor,
  REP_KORCE,
  REP_TIRANA,
} from "../support/fixtures";

/**
 * Phase 5C order management against the real database. Rates are created in
 * 2023 windows of their own, so other test files' rates never interfere.
 */

let P1 = ""; // 1234.5678 ALL, VAT 20
let P2 = ""; // 99.99 ALL, VAT 6
let INACTIVE = "";
let alba = ""; // Market Alba (rep.tirana)
let liqeni = ""; // Restorant Liqeni (rep.korce)

const uid = () => Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

async function product(net: string, vat: string, isActive = true) {
  const cat = await db().category.findUniqueOrThrow({ where: { name: "Pije" } });
  return (await db().product.create({ data: { sku: "T5C-" + uid(), name: "Test product " + net, categoryId: cat.id, unit: "cope", defaultNetAll: net, vatRate: vat, isActive } })).id;
}

async function rate(code: "EUR" | "USD", day: string, value: string) {
  await db().exchangeRate.create({ data: { currencyCode: code, effectiveAt: new Date(day + "T00:00:00Z"), allPerUnit: value } });
}

async function freshCustomer(repEmail: string) {
  const rep = await principalFor(repEmail);
  return db().customer.create({
    data: {
      businessName: "Order Test " + uid(),
      nipt: freshNipt(),
      businessType: "GROCERY",
      city: "Tiranë",
      assignedRepId: rep.employeeId,
      addresses: { create: [{ street: "Rr. Testit 1", city: "Tiranë", isDefault: true }] },
    },
    include: { addresses: true },
  });
}

const body = (over: Record<string, unknown> = {}) => ({
  customerId: alba,
  orderDate: "2023-03-10",
  currencyCode: "EUR",
  lines: [
    { productId: P1, quantity: "3", discountPercent: "12.5" },
    { productId: P2, quantity: "2.5" },
  ],
  ...over,
});

beforeAll(async () => {
  P1 = await product("1234.5678", "20");
  P2 = await product("99.99", "6");
  INACTIVE = await product("10", "20", false);
  alba = (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba } })).id;
  liqeni = (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.liqeni } })).id;
  await rate("EUR", "2023-03-01", "105.5");
  await rate("USD", "2023-03-01", "95.25");
});

describe("server-side pricing", () => {
  it("prices EUR orders from net ALL at the stored rate, discount before VAT, HALF_UP", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body());
    expect(o.orderNumber).toMatch(/^SO-2023-\d{3}$/);
    expect(o).toMatchObject({ status: "DRAFT", currencyCode: "EUR", allPerUnit: "105.5", editable: true });
    const [a, b] = [o.items.find((i) => i.productId === P1)!, o.items.find((i) => i.productId === P2)!];
    // 1234.5678 / 105.5 = 11.70206… → 11.7021; 3 × = 35.1063 → 35.11; 12.5 % = 4.38875 → 4.39; VAT 20 % of 30.72 = 6.144 → 6.14
    expect(a).toMatchObject({ unitNetPrice: "11.7021", grossNet: "35.11", discountAmount: "4.39", taxableAmount: "30.72", vatAmount: "6.14", lineTotal: "36.86", vatRate: "20", priceOverride: false });
    // 99.99 / 105.5 = 0.94777… → 0.9478; 2.5 × = 2.3695 → 2.37; VAT 6 % = 0.1422 → 0.14
    expect(b).toMatchObject({ unitNetPrice: "0.9478", grossNet: "2.37", discountAmount: "0.00", vatAmount: "0.14", lineTotal: "2.51", vatRate: "6" });
    expect(o.totals).toEqual({ subtotalNet: "37.48", discountTotal: "4.39", taxableTotal: "33.09", vatTotal: "6.28", grandTotal: "39.37" });
    expect(o.grandTotalAll).toBe("4153.54"); // 39.37 × 105.5 = 4153.535 → HALF_UP
  });

  it("ignores totals sent by the browser and matches the quote exactly", async () => {
    const m = await principalFor(MANAGER);
    const forged = body({ totals: { grandTotal: "1.00" }, grandTotal: "1.00", lines: [{ productId: P1, quantity: "3", discountPercent: "12.5", lineTotal: "0.01" }] });
    const quote = await quoteOrder(m, forged);
    const o = await createOrder(m, forged);
    expect(o.totals.grandTotal).toBe("36.86");
    expect(quote.totals).toEqual(o.totals);
    expect(quote.rate.allPerUnit).toBe("105.50");
  });

  it("prices ALL orders at rate 1 and snapshots product name, SKU, unit and VAT", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body({ currencyCode: "ALL", lines: [{ productId: P1, quantity: "1.5" }] }));
    expect(o).toMatchObject({ allPerUnit: "1", grandTotalAll: null });
    // 1.5 × 1234.5678 = 1851.8517 → 1851.85; VAT 370.37
    expect(o.items[0]).toMatchObject({ unitNetPrice: "1234.5678", grossNet: "1851.85", vatAmount: "370.37", lineTotal: "2222.22", unit: "cope" });
    await db().product.update({ where: { id: P1 }, data: { name: "Renamed later", vatRate: "10" } });
    try {
      const again = await getOrder(m, o.id);
      expect(again.items[0]).toMatchObject({ name: "Test product 1234.5678", vatRate: "20", lineTotal: "2222.22" });
    } finally {
      await db().product.update({ where: { id: P1 }, data: { name: "Test product 1234.5678", vatRate: "20" } });
    }
  });

  it("uses USD rates and refuses currencies without a rate on the order date", async () => {
    const m = await principalFor(MANAGER);
    const usd = await createOrder(m, body({ currencyCode: "USD", lines: [{ productId: P2, quantity: "10" }] }));
    expect(usd).toMatchObject({ allPerUnit: "95.25" });
    expect(usd.items[0].unitNetPrice).toBe("1.0498"); // 99.99 / 95.25 = 1.04976… → 1.0498
    for (const status of ["DRAFT", "CONFIRMED"]) {
      expect(await errorCode(createOrder(m, body({ orderDate: "2022-06-01", status })))).toBe("NO_EXCHANGE_RATE");
    }
    expect(await errorCode(quoteOrder(m, body({ orderDate: "2022-06-01" })))).toBe("NO_EXCHANGE_RATE");
  });

  it("rejects invalid quantities, prices, discounts, dates and products", async () => {
    const m = await principalFor(MANAGER);
    const line = (l: Record<string, unknown>) => body({ lines: [{ productId: P1, quantity: "1", ...l }] });
    expect(await invalidFields(createOrder(m, line({ quantity: "0" })))).toEqual(["lines.0.quantity"]);
    expect(await invalidFields(createOrder(m, line({ quantity: "-2" })))).toEqual(["lines.0.quantity"]);
    expect(await invalidFields(createOrder(m, line({ quantity: "1.2345" })))).toEqual(["lines.0.quantity"]);
    expect(await invalidFields(createOrder(m, line({ quantity: "abc" })))).toEqual(["lines.0.quantity"]);
    expect(await invalidFields(createOrder(m, line({ unitNetPrice: "1.23456" })))).toEqual(["lines.0.unitNetPrice"]);
    expect(await invalidFields(createOrder(m, line({ unitNetPrice: "-1" })))).toEqual(["lines.0.unitNetPrice"]);
    expect(await invalidFields(createOrder(m, line({ discountPercent: "100.5" })))).toEqual(["lines.0.discountPercent"]);
    expect(await invalidFields(createOrder(m, line({ discountPercent: "1.234" })))).toEqual(["lines.0.discountPercent"]);
    expect(await invalidFields(createOrder(m, body({ lines: [] })))).toEqual(["lines"]);
    expect(await invalidFields(createOrder(m, body({ currencyCode: "GBP" })))).toEqual(["currencyCode"]);
    expect(await invalidFields(createOrder(m, body({ orderDate: "2023-02-30" })))).toEqual(["orderDate"]);
    // Rules that need the database come back as 422 with field details too.
    const future = createOrder(m, body({ orderDate: "2099-01-01" }));
    await expect(future).rejects.toMatchObject({ status: 422, details: { orderDate: ["Order date can't be in the future."] } });
    await expect(createOrder(m, line({ productId: INACTIVE }))).rejects.toMatchObject({ status: 422, details: { "lines.0.productId": [expect.stringContaining("inactive")] } });
    const otherAddress = (await db().customerAddress.findFirstOrThrow({ where: { customerId: liqeni } })).id;
    await expect(createOrder(m, body({ deliveryAddressId: otherAddress }))).rejects.toMatchObject({ status: 422, details: { deliveryAddressId: expect.any(Array) } });
  });
});

describe("authorization and ownership", () => {
  it("representatives order only for their own customers and are always the attributed rep", async () => {
    const rep = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const o = await createOrder(rep, body({ currencyCode: "ALL" }));
    expect(o.salesRepId).toBe(rep.employeeId);
    expect(await errorCode(createOrder(rep, body({ customerId: liqeni })))).toBe("NOT_FOUND");
    expect(await errorCode(createOrder(rep, body({ salesRepId: korce.employeeId })))).toBe("FORBIDDEN");
    // Out-of-scope orders are invisible: 404 for read, edit, confirm and status.
    expect(await errorCode(getOrder(korce, o.id))).toBe("NOT_FOUND");
    expect(await errorCode(updateOrder(korce, o.id, { ...body({ currencyCode: "ALL" }), version: o.version }))).toBe("NOT_FOUND");
    expect(await errorCode(confirmOrder(korce, o.id))).toBe("NOT_FOUND");
    expect(await errorCode(changeOrderStatus(korce, o.id, "CONFIRMED"))).toBe("NOT_FOUND");
  });

  it("representatives cannot override prices; managers can, and the override is flagged", async () => {
    const rep = await principalFor(REP_TIRANA);
    const m = await principalFor(MANAGER);
    const overridden = body({ currencyCode: "ALL", lines: [{ productId: P1, quantity: "1", unitNetPrice: "1000" }] });
    await expect(createOrder(rep, overridden)).rejects.toMatchObject({ status: 403, code: "PRICE_OVERRIDE_FORBIDDEN", details: { "lines.0.unitNetPrice": expect.any(Array) } });
    expect(await errorCode(quoteOrder(rep, overridden))).toBe("PRICE_OVERRIDE_FORBIDDEN");
    // Sending the catalogue price explicitly is not an override.
    const same = await createOrder(rep, body({ currencyCode: "ALL", lines: [{ productId: P1, quantity: "1", unitNetPrice: "1234.5678" }] }));
    expect(same.items[0].priceOverride).toBe(false);
    const mo = await createOrder(m, overridden);
    expect(mo.items[0]).toMatchObject({ unitNetPrice: "1000", priceOverride: true, lineTotal: "1200.00" });
    expect(mo.actions.overridePrices).toBe(true);

    // A rep editing the manager's draft keeps the override if they leave it unchanged…
    const kept = await updateOrder(rep, mo.id, { ...overridden, version: mo.version, lines: [{ id: mo.items[0].id, productId: P1, quantity: "2", unitNetPrice: "1000" }] });
    expect(kept.items[0]).toMatchObject({ quantity: "2", unitNetPrice: "1000", lineTotal: "2400.00" });
    // …but cannot change it.
    expect(await errorCode(updateOrder(rep, mo.id, { ...overridden, version: kept.version, lines: [{ id: kept.items[0].id, productId: P1, quantity: "2", unitNetPrice: "900" }] }))).toBe("PRICE_OVERRIDE_FORBIDDEN");
  });

  it("only managers and admins cancel; reps may confirm and fulfil their own orders", async () => {
    const rep = await principalFor(REP_TIRANA);
    const o = await createOrder(rep, body({ currencyCode: "ALL" }));
    expect(o.actions).toMatchObject({ edit: true, confirm: true, cancel: false, overridePrices: false });
    expect(await errorCode(changeOrderStatus(rep, o.id, "CANCELLED"))).toBe("FORBIDDEN");
    expect((await confirmOrder(rep, o.id)).status).toBe("CONFIRMED");
    expect((await changeOrderStatus(rep, o.id, "PROCESSING")).status).toBe("PROCESSING");
  });

  it("keeps the original sales rep when the customer is reassigned", async () => {
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const m = await principalFor(MANAGER);
    const c = await freshCustomer(REP_TIRANA);
    const o = await createOrder(tirana, body({ customerId: c.id, currencyCode: "ALL", deliveryAddressId: c.addresses[0].id }));
    expect(o.delivery).toMatchObject({ street: "Rr. Testit 1", city: "Tiranë" });
    await reassignCustomers(m, tirana.employeeId!, { toEmployeeId: korce.employeeId!, customerIds: [c.id] });
    const after = await getOrder(m, o.id);
    expect(after.salesRep.id).toBe(tirana.employeeId);
    // Tirana still sees the sale; Korçë sees it through the customer and can't change the attribution.
    expect((await getOrder(tirana, o.id)).id).toBe(o.id);
    const edited = await updateOrder(korce, o.id, { ...body({ customerId: c.id, currencyCode: "ALL" }), version: after.version });
    expect(edited.salesRep.id).toBe(tirana.employeeId);
  });

  it("lists only orders in the caller's scope, with filters and allowlisted sorting", async () => {
    const korce = await principalFor(REP_KORCE);
    const m = await principalFor(MANAGER);
    const mine = await createOrder(m, body({ customerId: liqeni, currencyCode: "ALL" }));
    const page = await listOrders(korce, orderListQuery.parse({ pageSize: "100" }));
    // Searched by number: other files' fixture orders (stamped with the time of day) can fill the first page.
    expect((await listOrders(korce, orderListQuery.parse({ q: mine.orderNumber }))).items.map((o) => o.id)).toEqual([mine.id]);
    const custs = await db().customer.findMany({ where: { id: { in: page.items.map((o) => o.customer.id) } }, select: { assignedRepId: true } });
    expect(page.items.every((o) => o.salesRep.id === korce.employeeId) || custs.every((c) => c.assignedRepId === korce.employeeId)).toBe(true);
    const found = await listOrders(m, orderListQuery.parse({ q: mine.orderNumber }));
    expect(found.items.map((o) => o.orderNumber)).toEqual([mine.orderNumber]);
    const invoiced = await listOrders(m, orderListQuery.parse({ status: "INVOICED", pageSize: "100" }));
    expect(invoiced.items.length).toBeGreaterThan(0);
    expect(invoiced.items.every((o) => o.invoiced)).toBe(true);
    expect(invalidFieldsSync(() => orderListQuery.parse({ sort: "customer.passwordHash" }))).toEqual(["sort"]);
  });
});

function invalidFieldsSync(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    return ((e as { issues: { path: string[] }[] }).issues ?? []).map((i) => i.path.join("."));
  }
  return [];
}

describe("editing, confirmation and lifecycle", () => {
  it("edits drafts and confirmed orders, re-pricing on the server", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body());
    const edited = await updateOrder(m, o.id, { ...body({ lines: [{ productId: P2, quantity: "100", discountPercent: "10" }] }), version: o.version });
    // 100 × 0.9478 = 94.78; 10 % = 9.478 → 9.48; taxable 85.30; VAT 6 % = 5.118 → 5.12
    expect(edited.totals).toEqual({ subtotalNet: "94.78", discountTotal: "9.48", taxableTotal: "85.30", vatTotal: "5.12", grandTotal: "90.42" });
    expect(edited.items).toHaveLength(1);
    const confirmed = await confirmOrder(m, o.id, edited.version);
    expect(confirmed).toMatchObject({ status: "CONFIRMED", totals: edited.totals, editable: true });
    const again = await updateOrder(m, o.id, { ...body({ currencyCode: "ALL", lines: [{ productId: P2, quantity: "1" }] }), version: confirmed.version });
    expect(again).toMatchObject({ status: "CONFIRMED", allPerUnit: "1" });
    expect(again.totals.grandTotal).toBe("105.99"); // 99.99 + 6 % (5.9994 → 6.00)
  });

  it("refuses edits after processing starts or once invoiced, and protects the invoice snapshot", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body({ status: "CONFIRMED" }));
    expect(o.status).toBe("CONFIRMED");
    const inv = await invoiceOrder(o.id);
    const locked = await getOrder(m, o.id);
    expect(locked).toMatchObject({ financiallyLocked: true, editable: false, actions: { edit: false } });
    expect(locked.items.every((i) => i.priceOverride === null)).toBe(true);
    expect(await errorCode(updateOrder(m, o.id, { ...body(), version: locked.version }))).toBe("ORDER_FINANCIALLY_LOCKED");
    // Operational transitions after invoicing leave every amount untouched.
    await changeOrderStatus(m, o.id, "PROCESSING");
    await changeOrderStatus(m, o.id, "DELIVERED");
    const done = await getOrder(m, o.id);
    expect(done.totals).toEqual(locked.totals);
    expect(done.items).toEqual(locked.items);
    expect((await db().invoice.findUniqueOrThrow({ where: { id: inv.id } })).total.toFixed(2)).toBe(locked.totals.grandTotal);

    const p2 = await createOrder(m, body({ status: "CONFIRMED" }));
    await changeOrderStatus(m, p2.id, "PROCESSING");
    const view = await getOrder(m, p2.id);
    expect(await errorCode(updateOrder(m, p2.id, { ...body(), version: view.version }))).toBe("ORDER_NOT_EDITABLE");
  });

  it("validates transitions and confirmation preconditions", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body());
    expect(await errorCode(changeOrderStatus(m, o.id, "PROCESSING"))).toBe("INVALID_STATUS_TRANSITION"); // draft must be confirmed first
    expect(await errorCode(changeOrderStatus(m, o.id, "DELIVERED"))).toBe("INVALID_STATUS_TRANSITION");
    expect(await errorCode(changeOrderStatus(m, o.id, "DRAFT"))).toBe("INVALID_STATUS_TRANSITION");
    await confirmOrder(m, o.id);
    expect(await errorCode(confirmOrder(m, o.id))).toBe("INVALID_STATUS_TRANSITION");
    expect((await changeOrderStatus(m, o.id, "CANCELLED")).status).toBe("CANCELLED");
    expect(await errorCode(changeOrderStatus(m, o.id, "PROCESSING"))).toBe("INVALID_STATUS_TRANSITION");
    const cancelled = await getOrder(m, o.id);
    expect(await errorCode(updateOrder(m, o.id, { ...body(), version: cancelled.version }))).toBe("ORDER_NOT_EDITABLE");

    // A customer blocked after the draft was saved can't have it confirmed.
    const c = await freshCustomer(REP_TIRANA);
    const d = await createOrder(m, body({ customerId: c.id, currencyCode: "ALL" }));
    await db().customer.update({ where: { id: c.id }, data: { status: "BLOCKED" } });
    expect(await errorCode(confirmOrder(m, d.id))).toBe("CUSTOMER_NOT_ACTIVE");
    expect(await errorCode(createOrder(m, body({ customerId: c.id, currencyCode: "ALL" })))).toBe("CUSTOMER_NOT_ACTIVE");
  });

  it("keeps the rate snapshot when new rates are entered, and re-checks it on confirmation", async () => {
    const m = await principalFor(MANAGER);
    await rate("EUR", "2023-05-01", "110");
    const confirmed = await createOrder(m, body({ orderDate: "2023-05-20", status: "CONFIRMED" }));
    const draft = await createOrder(m, body({ orderDate: "2023-05-20" }));
    expect(draft.allPerUnit).toBe("110");
    // A later rate never touches existing orders.
    await rate("EUR", "2023-06-01", "120");
    expect((await getOrder(m, confirmed.id)).allPerUnit).toBe("110");
    // A back-dated correction that applies to the draft's date must be reviewed first.
    await rate("EUR", "2023-05-15", "111");
    expect((await getOrder(m, confirmed.id)).allPerUnit).toBe("110");
    expect(await errorCode(confirmOrder(m, draft.id))).toBe("EXCHANGE_RATE_CHANGED");
    const resaved = await updateOrder(m, draft.id, { ...body({ orderDate: "2023-05-20" }), version: draft.version });
    expect(resaved.allPerUnit).toBe("111");
    expect((await confirmOrder(m, draft.id)).status).toBe("CONFIRMED");
  });
});

describe("concurrency", () => {
  it("applies only one of two edits made from the same version", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body());
    const results = await Promise.allSettled([
      updateOrder(m, o.id, { ...body({ lines: [{ productId: P1, quantity: "1" }] }), version: o.version }),
      updateOrder(m, o.id, { ...body({ lines: [{ productId: P2, quantity: "1" }] }), version: o.version }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.code).toBe("CONCURRENT_UPDATE");
    expect((await getOrder(m, o.id)).items).toHaveLength(1);
  });

  it("does not confirm an order that changed since it was viewed, nor confirm twice concurrently", async () => {
    const m = await principalFor(MANAGER);
    const o = await createOrder(m, body());
    await updateOrder(m, o.id, { ...body({ lines: [{ productId: P1, quantity: "9" }] }), version: o.version });
    expect(await errorCode(confirmOrder(m, o.id, o.version))).toBe("CONCURRENT_UPDATE");
    const results = await Promise.allSettled([confirmOrder(m, o.id), confirmOrder(m, o.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("numbers concurrently created orders uniquely and consecutively", async () => {
    const m = await principalFor(MANAGER);
    const made = await Promise.all(Array.from({ length: 6 }, () => createOrder(m, body({ orderDate: "2023-03-11", currencyCode: "ALL" }))));
    const nums = made.map((o) => Number(o.orderNumber.split("-")[2])).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(6);
    expect(nums[5] - nums[0]).toBe(5);
  });

  it("existing fixture orders (non-SO numbers) do not disturb numbering", async () => {
    const m = await principalFor(MANAGER);
    await fixtureOrder({ nipt: NIPT.marketAlba, status: "DRAFT" });
    const o = await createOrder(m, body({ currencyCode: "ALL" }));
    expect(o.orderNumber).toMatch(/^SO-2023-\d{3}$/);
  });
});
