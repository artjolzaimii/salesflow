import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { db, freshNipt, MANAGER, NIPT, REP_KORCE, REP_TIRANA } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

const newCustomer = () => ({
  businessName: "HTTP Test " + Math.random().toString(36).slice(2, 7),
  nipt: freshNipt(),
  businessType: "RESTAURANT",
  businessSize: "MEDIUM",
  city: "Durrës",
  contacts: [{ fullName: "Http Contact", phone: "+355 68 111 2222" }],
  addresses: [{ street: "Rr. Http 5", city: "Durrës" }],
});

describe.skipIf(!base)("business module APIs over HTTP", () => {
  let manager: string, admin: string, tirana: string, korce: string;
  beforeAll(async () => {
    [manager, admin, tirana, korce] = (await Promise.all([MANAGER, "admin@salesflow.test", REP_TIRANA, REP_KORCE].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
  });

  it("answers 401 on every new endpoint without a session", async () => {
    const id = (await db().customer.findFirstOrThrow()).id;
    for (const path of ["/api/customers", `/api/customers/${id}`, "/api/employees", "/api/products", "/api/categories", "/api/exchange-rates"]) {
      expect((await api.get(path)).status, path).toBe(401);
    }
    expect((await api.post("/api/customers", newCustomer())).status).toBe(401);
    expect((await api.post("/api/products", {})).status).toBe(401);
    expect((await api.post("/api/exchange-rates", {})).status).toBe(401);
    expect((await api.del(`/api/categories/${id}`)).status).toBe(401);
  });

  it("answers 403 to representatives on management endpoints", async () => {
    const cat = (await db().category.findFirstOrThrow()).id;
    expect((await api.get("/api/employees", tirana)).status).toBe(403);
    expect((await api.post("/api/employees", { firstName: "a", lastName: "b" }, manager)).status).toBe(403); // admin only
    expect((await api.post("/api/products", { sku: "X1", name: "x", categoryId: cat, unit: "u", defaultNetAll: "1", vatRate: "20" }, tirana)).status).toBe(403);
    expect((await api.post("/api/categories", { name: "Nope" }, tirana)).status).toBe(403);
    expect((await api.post("/api/exchange-rates", { currencyCode: "EUR", allPerUnit: "98", effectiveAt: "2026-01-02" }, tirana)).status).toBe(403);
    expect((await api.get("/api/products", tirana)).status).toBe(200);
    expect((await api.get("/api/exchange-rates", tirana)).status).toBe(200);
  });

  it("creates, reads and edits a customer; another rep gets 404", async () => {
    const created = await api.post("/api/customers", newCustomer(), tirana);
    expect(created.status).toBe(201);
    const { customer } = await created.json();
    expect(customer.contacts).toHaveLength(1);
    expect((await api.get(`/api/customers/${customer.id}`, korce)).status).toBe(404);
    expect((await api.patch(`/api/customers/${customer.id}`, { businessName: "Taken" }, korce)).status).toBe(404);
    const edited = await api.patch(`/api/customers/${customer.id}`, { notes: "Deliver before 10:00", businessSize: "LARGE" }, tirana);
    expect(edited.status).toBe(200);
    expect((await edited.json()).customer).toMatchObject({ notes: "Deliver before 10:00", businessSize: "LARGE" });
    const contact = await api.post(`/api/customers/${customer.id}/contacts`, { fullName: "Second" }, tirana);
    expect(contact.status).toBe(201);
    const cid = (await contact.json()).contact.id;
    expect((await api.del(`/api/customers/${customer.id}/contacts/${cid}`, tirana)).status).toBe(200); // DELETE needs no body
    expect((await api.get(`/api/customers/not-a-uuid`, manager)).status).toBe(404);
  });

  it("returns 409 for a duplicate NIPT and 422 with field details for invalid input", async () => {
    const dup = await api.post("/api/customers", { ...newCustomer(), nipt: NIPT.marketAlba }, manager);
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("DUPLICATE_NIPT");
    const bad = await api.post("/api/customers", { ...newCustomer(), nipt: "123", contacts: [] }, manager);
    expect(bad.status).toBe(422);
    const body = await bad.json();
    expect(Object.keys(body.error.details)).toEqual(expect.arrayContaining(["nipt", "contacts"]));
  });

  it("paginates and rejects unknown sort fields", async () => {
    const page = await (await api.get("/api/customers?pageSize=2&page=1&sort=businessName&dir=desc", manager)).json();
    expect(page).toMatchObject({ page: 1, pageSize: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    expect((await api.get("/api/customers?sort=passwordHash", manager)).status).toBe(422);
    expect((await api.get("/api/products?pageSize=500", manager)).status).toBe(422);
    const scoped = await (await api.get("/api/customers?pageSize=100", korce)).json();
    expect(scoped.items.every((c: { assignedRep: { name: string } }) => c.assignedRep.name === "Mira Leka")).toBe(true);
  });

  it("manages products and categories with exact decimals", async () => {
    const cat = await api.post("/api/categories", { name: "HTTP Cat " + Date.now() }, manager);
    expect(cat.status).toBe(201);
    const categoryId = (await cat.json()).category.id;
    const sku = "HTTP-" + Date.now();
    const p = await api.post("/api/products", { sku, name: "Http product", categoryId, unit: "kg", defaultNetAll: "12.3456", vatRate: "10" }, manager);
    expect(p.status).toBe(201);
    const product = (await p.json()).product;
    expect(product).toMatchObject({ defaultNetAll: "12.3456", vatRate: "10", isActive: true });
    expect((await api.post("/api/products", { sku, name: "dup", categoryId, unit: "kg", defaultNetAll: "1", vatRate: "20" }, manager)).status).toBe(409);
    expect((await api.post("/api/products", { sku: sku + "B", name: "x", categoryId, unit: "kg", defaultNetAll: "1.23456", vatRate: "20" }, manager)).status).toBe(422);
    expect((await (await api.patch(`/api/products/${product.id}`, { isActive: false }, manager)).json()).product.isActive).toBe(false);
    expect((await api.del(`/api/categories/${categoryId}`, manager)).status).toBe(409); // has a product
  });

  it("appends exchange rates and exposes the current one", async () => {
    const res = await api.post("/api/exchange-rates", { currencyCode: "USD", allPerUnit: "91.4", effectiveAt: "2026-11-15" }, manager);
    expect(res.status).toBe(201);
    const list = await (await api.get("/api/exchange-rates?currency=USD", tirana)).json();
    expect(list.items[0].currencyCode).toBe("USD");
    expect(list.current.find((c: { currencyCode: string }) => c.currencyCode === "ALL").rate.allPerUnit).toBe("1");
    expect((await api.post("/api/exchange-rates", { currencyCode: "ALL", allPerUnit: "1", effectiveAt: "2026-11-15" }, manager)).status).toBe(422);
  });

  it("never returns password hashes from employee endpoints", async () => {
    const list = await api.get("/api/employees?pageSize=100", admin);
    const text = await list.text();
    expect(list.status).toBe(200);
    expect(text).not.toMatch(/passwordHash|\$2[aby]\$/);
    const id = JSON.parse(text).items[0].id;
    expect(await (await api.get(`/api/employees/${id}`, admin)).text()).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it("reuses one connection pool across many requests (no per-request clients)", async () => {
    for (let i = 0; i < 60; i++) await api.get("/api/me", manager);
    const [{ n }] = await db().$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()`;
    expect(Number(n)).toBeLessThan(30); // one pg pool (default max 10) for the server + the test runner's own
  });
});
