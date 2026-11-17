import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { db, MANAGER, NIPT, REP_KORCE, REP_TIRANA } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/** The Phase 5C order endpoints over HTTP, against `next start` on the test database. */
describe.skipIf(!base)("order APIs over HTTP", () => {
  let manager: string, tirana: string, korce: string;
  let alba: string, drk1: string, drk2: string;
  // Before every other test file's rates: EUR resolves to the seeded 100.
  const DAY = "2026-10-20";

  beforeAll(async () => {
    [manager, tirana, korce] = (await Promise.all([MANAGER, REP_TIRANA, REP_KORCE].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
    alba = (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.marketAlba } })).id;
    drk1 = (await db().product.findUniqueOrThrow({ where: { sku: "DRK-001" } })).id;
    drk2 = (await db().product.findUniqueOrThrow({ where: { sku: "DRK-002" } })).id;
  });

  const order = (over: Record<string, unknown> = {}) => ({
    customerId: alba,
    orderDate: DAY,
    currencyCode: "EUR",
    lines: [
      { productId: drk1, quantity: "10" },
      { productId: drk2, quantity: "3", discountPercent: "10" },
    ],
    ...over,
  });

  it("answers 401 on every order endpoint without a session", async () => {
    const id = (await db().order.findFirstOrThrow()).id;
    for (const path of ["/api/orders", `/api/orders/${id}`, "/api/exchange-rates/applicable?currency=EUR&date=2026-10-20"]) {
      expect((await api.get(path)).status, path).toBe(401);
    }
    expect((await api.post("/api/orders", order())).status).toBe(401);
    expect((await api.post("/api/orders/quote", order())).status).toBe(401);
    expect((await api.patch(`/api/orders/${id}`, order())).status).toBe(401);
    expect((await api.post(`/api/orders/${id}/confirm`, {})).status).toBe(401);
    expect((await api.post(`/api/orders/${id}/status`, { status: "PROCESSING" })).status).toBe(401);
  });

  it("creates an order priced on the server, ignoring browser totals", async () => {
    const res = await api.post("/api/orders", { ...order(), grandTotal: "0.01", totals: { grandTotal: "0.01" } }, manager);
    expect(res.status).toBe(201);
    const { order: o } = await res.json();
    // EUR at 100: 80/100 = 0.8000 × 10 = 8.00 (+1.60 VAT); 150/100 = 1.5000 × 3 = 4.50, −0.45, VAT 0.81
    expect(o).toMatchObject({ status: "DRAFT", currencyCode: "EUR", allPerUnit: "100", rateText: "100.00" });
    expect(o.totals).toEqual({ subtotalNet: "12.50", discountTotal: "0.45", taxableTotal: "12.05", vatTotal: "2.41", grandTotal: "14.46" });
    expect(o.grandTotalAll).toBe("1446.00");
    const quote = await (await api.post("/api/orders/quote", order(), manager)).json();
    expect(quote.quote.totals).toEqual(o.totals);
  });

  it("validates input with 415/422 and field details", async () => {
    const text = await fetch(base + "/api/orders", { method: "POST", headers: { cookie: manager, "content-type": "text/plain" }, body: "x" });
    expect(text.status).toBe(415);
    const bad = await api.post("/api/orders", order({ lines: [{ productId: drk1, quantity: "0" }, { productId: drk1, quantity: "1", discountPercent: "101" }] }), manager);
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).error.details).sort()).toEqual(["lines.0.quantity", "lines.1.discountPercent"]);
    const future = await api.post("/api/orders", order({ orderDate: "2099-12-31" }), manager);
    expect(future.status).toBe(422);
    expect((await future.json()).error.details).toEqual({ orderDate: ["Order date can't be in the future."] });
    const noRate = await api.post("/api/orders", order({ orderDate: "2022-01-03" }), manager);
    expect(noRate.status).toBe(409);
    expect((await noRate.json()).error).toMatchObject({ code: "NO_EXCHANGE_RATE", message: expect.stringContaining("Settings") });
    const cross = await fetch(base + "/api/orders", { method: "POST", headers: { cookie: manager, "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify(order()) });
    expect(cross.status).toBe(403);
  });

  it("enforces ownership and role rules", async () => {
    const created = await (await api.post("/api/orders", order({ currencyCode: "ALL" }), tirana)).json();
    const id = created.order.id;
    expect(created.order.salesRep.name).toBe("Erion Hoxha");
    expect((await api.get(`/api/orders/${id}`, korce)).status).toBe(404);
    expect((await api.patch(`/api/orders/${id}`, { ...order(), version: created.order.version }, korce)).status).toBe(404);
    expect((await api.post(`/api/orders/${id}/status`, { status: "CANCELLED" }, tirana)).status).toBe(403);
    const override = await api.post("/api/orders", order({ currencyCode: "ALL", lines: [{ productId: drk1, quantity: "1", unitNetPrice: "50" }] }), tirana);
    expect(override.status).toBe(403);
    expect((await override.json()).error).toMatchObject({ code: "PRICE_OVERRIDE_FORBIDDEN", details: { "lines.0.unitNetPrice": [expect.any(String)] } });
    expect((await api.post("/api/orders", order({ customerId: (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.liqeni } })).id }), tirana)).status).toBe(404);
    const korceList = (await (await api.get("/api/orders?pageSize=100", korce)).json()).items as { id: string }[];
    expect(korceList.map((o) => o.id)).not.toContain(id);
  });

  it("edits with optimistic concurrency, confirms and moves through the lifecycle", async () => {
    const { order: o } = await (await api.post("/api/orders", order(), manager)).json();
    const edited = await api.patch(`/api/orders/${o.id}`, { ...order({ lines: [{ productId: drk1, quantity: "5" }] }), version: o.version }, manager);
    expect(edited.status).toBe(200);
    const e = (await edited.json()).order;
    expect(e.totals.grandTotal).toBe("4.80");
    const stale = await api.patch(`/api/orders/${o.id}`, { ...order(), version: o.version }, manager);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("CONCURRENT_UPDATE");
    expect((await api.post(`/api/orders/${o.id}/status`, { status: "DELIVERED" }, manager)).status).toBe(409);
    expect((await api.post(`/api/orders/${o.id}/confirm`, { version: e.version }, manager)).status).toBe(200);
    expect((await api.post(`/api/orders/${o.id}/status`, { status: "PROCESSING" }, manager)).status).toBe(200);
    const view = (await (await api.get(`/api/orders/${o.id}`, manager)).json()).order;
    expect(view).toMatchObject({ status: "PROCESSING", editable: false, totals: e.totals });
    const locked = await api.patch(`/api/orders/${o.id}`, { ...order(), version: view.version }, manager);
    expect((await locked.json()).error.code).toBe("ORDER_NOT_EDITABLE");
  });

  it("lists with pagination, filters and allowlisted sorting", async () => {
    const page = await (await api.get("/api/orders?pageSize=2&page=1&sort=grandTotal&dir=desc", manager)).json();
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.pages).toBeGreaterThanOrEqual(2);
    expect(Number(page.items[0].grandTotal)).toBeGreaterThanOrEqual(Number(page.items[1].grandTotal));
    expect((await api.get("/api/orders?sort=customer", manager)).status).toBe(422);
    expect((await api.get("/api/orders?pageSize=500", manager)).status).toBe(422);
    const invoiced = await (await api.get("/api/orders?status=INVOICED&q=SO-2026-001", manager)).json();
    expect(invoiced.items.map((o: { orderNumber: string }) => o.orderNumber)).toEqual(["SO-2026-001"]);
  });

  it("reports the exchange rate an order date would use", async () => {
    const eur = await (await api.get("/api/exchange-rates/applicable?currency=EUR&date=2026-10-20", tirana)).json();
    expect(eur).toMatchObject({ currencyCode: "EUR", rate: { allPerUnit: "100.00" }, message: null });
    const none = await (await api.get("/api/exchange-rates/applicable?currency=USD&date=2022-01-03", tirana)).json();
    expect(none).toMatchObject({ rate: null, message: expect.stringContaining("No USD exchange rate") });
    expect((await api.get("/api/exchange-rates/applicable?currency=GBP&date=2026-10-20", tirana)).status).toBe(422);
  });
});
