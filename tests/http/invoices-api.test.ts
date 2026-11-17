import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../support/env";
import { createOrder, daysFromToday, db, INVOICE_NUMBER, invoiceSeq, key, MANAGER, NIPT, REP_KORCE, REP_TIRANA } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/** The Phase 5D invoice and payment endpoints over HTTP, against `next start` on the test database. */
describe.skipIf(!base)("invoice and payment APIs over HTTP", () => {
  let manager: string, tirana: string, korce: string;

  beforeAll(async () => {
    [manager, tirana, korce] = (await Promise.all([MANAGER, REP_TIRANA, REP_KORCE].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
  });

  const issue = (orderId: string, cookie = manager, body: Record<string, unknown> = {}) => api.post("/api/invoices", { orderId, dueDate: daysFromToday(30), ...body }, cookie);
  const payBody = (invoiceId: string, amount: string, extra: Record<string, unknown> = {}) => ({
    invoiceId,
    amount,
    paymentDate: daysFromToday(0),
    method: "BANK_TRANSFER",
    reference: "HTTP-" + key().slice(-6),
    idempotencyKey: key(),
    ...extra,
  });

  it("answers 401 on every invoice and payment endpoint without a session", async () => {
    const id = (await db().invoice.findFirstOrThrow()).id;
    const pid = (await db().payment.findFirstOrThrow()).id;
    for (const path of ["/api/invoices", `/api/invoices/${id}`, "/api/payments", `/api/payments/${pid}`]) {
      expect((await api.get(path)).status, path).toBe(401);
    }
    expect((await api.post("/api/invoices", { orderId: crypto.randomUUID(), dueDate: daysFromToday(30) })).status).toBe(401);
    expect((await api.post(`/api/invoices/${id}/cancel`, { reason: "nope" })).status).toBe(401);
    expect((await api.post(`/api/invoices/${id}/replacement`, { dueDate: daysFromToday(30) })).status).toBe(401);
    expect((await api.post("/api/payments", payBody(id, "1"))).status).toBe(401);
  });

  it("issues from a confirmed order with the next number, copying the order totals", async () => {
    const order = await createOrder({ nipt: NIPT.marketAlba, currency: "EUR", rate: "100", lines: [{ sku: "DRK-002", qty: "10" }] }); // 18.00 EUR
    const res = await issue(order.id, manager, { grandTotal: "0.01", issueDate: "2020-01-01" });
    expect(res.status).toBe(422); // unknown fields (client totals, issue date) are refused
    const first = await issue(order.id);
    expect(first.status).toBe(201);
    const inv = (await first.json()).invoice;
    expect(inv.invoiceNumber).toMatch(INVOICE_NUMBER);
    expect(inv).toMatchObject({ status: "ISSUED", currencyCode: "EUR", rateText: "100.00", issueDate: daysFromToday(0), paymentStatus: "UNPAID", order: { id: order.id } });
    expect(inv.totals.grandTotal).toBe("18.00");
    const again = await issue(order.id);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("ORDER_ALREADY_INVOICED");

    const next = await issue((await createOrder({ nipt: NIPT.marketAlba })).id);
    expect(invoiceSeq((await next.json()).invoice.invoiceNumber)).toBe(invoiceSeq(inv.invoiceNumber) + 1);
  });

  it("concurrent issue requests for one order create one invoice", async () => {
    const order = await createOrder({ nipt: NIPT.marketAlba });
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => issue(order.id)))).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await db().invoice.count({ where: { orderId: order.id } })).toBe(1);
  });

  it("validates due dates and refuses draft orders", async () => {
    const order = await createOrder({ nipt: NIPT.marketAlba });
    const past = await issue(order.id, manager, { dueDate: daysFromToday(-1) });
    expect(past.status).toBe(422);
    expect(Object.keys((await past.json()).error.details)).toEqual(["dueDate"]);
    const draft = await createOrder({ nipt: NIPT.marketAlba, status: "DRAFT" });
    const r = await issue(draft.id);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatchObject({ code: "ORDER_NOT_INVOICEABLE", message: expect.stringContaining("Confirm the order") });
  });

  it("records partial payments, replays by key, refuses overpayment, wrong currency and sub-cent amounts", async () => {
    const order = await createOrder({ nipt: NIPT.marketAlba, currency: "USD", rate: "90", lines: [{ sku: "DRK-002", qty: "10" }] }); // 20.00 USD
    const inv = (await (await issue(order.id)).json()).invoice;
    const body = payBody(inv.id, "7.50");
    const first = await api.post("/api/payments", body, manager);
    const replay = await api.post("/api/payments", body, manager);
    expect([first.status, replay.status]).toEqual([201, 200]);
    const view = (await (await api.get(`/api/invoices/${inv.id}`, manager)).json()).invoice;
    expect(view).toMatchObject({ paid: "7.50", outstanding: (Number(inv.totals.grandTotal) - 7.5).toFixed(2), paymentStatus: "PARTIALLY_PAID" });

    const over = await api.post("/api/payments", payBody(inv.id, "999.00"), manager);
    expect(over.status).toBe(409);
    expect((await over.json()).error).toMatchObject({ code: "OVERPAYMENT", details: { amount: [expect.stringContaining(view.outstanding)] } });
    const wrong = await api.post("/api/payments", payBody(inv.id, "1.00", { currencyCode: "EUR" }), manager);
    expect(wrong.status).toBe(422);
    expect(Object.keys((await wrong.json()).error.details)).toEqual(["currencyCode"]);
    expect((await api.post("/api/payments", payBody(inv.id, "1.001"), manager)).status).toBe(422);
    expect((await api.post("/api/payments", payBody(inv.id, "1.00", { method: "CARD", reference: "" }), manager)).status).toBe(422);

    const full = await api.post("/api/payments", payBody(inv.id, view.outstanding), manager);
    expect(full.status).toBe(201);
    const paid = (await (await api.get(`/api/invoices/${inv.id}`, manager)).json()).invoice;
    expect(paid).toMatchObject({ paymentStatus: "PAID", outstanding: "0.00", actions: { recordPayment: false, cancel: false } });
    expect(await db().payment.count({ where: { invoiceId: inv.id } })).toBe(2);
  });

  it("cancels with a reason and issues a replacement with a new number", async () => {
    const inv = (await (await issue((await createOrder({ nipt: NIPT.marketAlba })).id)).json()).invoice;
    expect((await api.post(`/api/invoices/${inv.id}/cancel`, { reason: "" }, manager)).status).toBe(422);
    expect((await api.post(`/api/invoices/${inv.id}/cancel`, { reason: "Wrong terms" }, tirana)).status).toBe(403);
    expect((await api.post(`/api/invoices/${inv.id}/cancel`, { reason: "Wrong terms" }, manager)).status).toBe(200);
    const cancelled = (await (await api.get(`/api/invoices/${inv.id}`, manager)).json()).invoice;
    expect(cancelled).toMatchObject({ status: "CANCELLED", invoiceNumber: inv.invoiceNumber, cancellation: { reason: "Wrong terms" }, actions: { replace: true } });
    expect((await issue(inv.order.id)).status).toBe(409); // REPLACEMENT_REQUIRED
    const repl = await api.post(`/api/invoices/${inv.id}/replacement`, { dueDate: daysFromToday(10) }, manager);
    expect(repl.status).toBe(201);
    const r = (await repl.json()).invoice;
    expect(r).toMatchObject({ replaces: { id: inv.id }, totals: inv.totals, dueDate: daysFromToday(10) });
    expect(r.invoiceNumber).not.toBe(inv.invoiceNumber);
    expect((await api.post(`/api/invoices/${inv.id}/replacement`, { dueDate: daysFromToday(10) }, manager)).status).toBe(409);
  });

  it("scopes representatives and keeps them read-only", async () => {
    const own = (await (await issue((await createOrder({ nipt: NIPT.marketAlba })).id)).json()).invoice;
    const foreign = (await (await issue((await createOrder({ nipt: NIPT.liqeni })).id)).json()).invoice;
    const payment = (await (await api.post("/api/payments", payBody(own.id, "1.00"), manager)).json()).payment;

    expect((await issue((await createOrder({ nipt: NIPT.marketAlba })).id, tirana)).status).toBe(403);
    expect((await api.post("/api/payments", payBody(own.id, "1.00"), tirana)).status).toBe(403);
    const mine = await api.get(`/api/invoices/${own.id}`, tirana);
    expect(mine.status).toBe(200);
    expect((await mine.json()).invoice.actions).toEqual({ recordPayment: false, cancel: false, replace: false });
    const hidden = await api.get(`/api/invoices/${foreign.id}`, tirana);
    const missing = await api.get(`/api/invoices/${crypto.randomUUID()}`, tirana);
    expect([hidden.status, missing.status]).toEqual([404, 404]);
    expect((await hidden.json()).error).toEqual((await missing.json()).error);
    expect((await api.get(`/api/payments/${payment.id}`, tirana)).status).toBe(200);
    expect((await api.get(`/api/payments/${payment.id}`, korce)).status).toBe(404);

    const list = (await (await api.get("/api/invoices?pageSize=100", korce)).json()).items as { id: string }[];
    expect(list.map((i) => i.id)).toContain(foreign.id);
    expect(list.map((i) => i.id)).not.toContain(own.id);
    const pays = (await (await api.get("/api/payments?pageSize=100", korce)).json()).items as { id: string }[];
    expect(pays.map((x) => x.id)).not.toContain(payment.id);
  });

  it("lists with filters, totals and allowlisted sorting", async () => {
    const page = await (await api.get("/api/invoices?status=OPEN&pageSize=2&sort=dueDate&dir=asc", manager)).json();
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.items.every((i: { outstanding: string; status: string }) => i.status === "ISSUED" && Number(i.outstanding) > 0)).toBe(true);
    expect(page.totals.length).toBeGreaterThan(0);
    expect((await api.get("/api/invoices?sort=customer", manager)).status).toBe(422);
    expect((await api.get("/api/invoices?status=LATE", manager)).status).toBe(422);
    expect((await api.get("/api/payments?sort=reference", manager)).status).toBe(422);
    const seeded = await (await api.get("/api/invoices?q=INV-2026-002", manager)).json();
    expect(seeded.items.map((i: { invoiceNumber: string }) => i.invoiceNumber)).toEqual(["INV-2026-002"]);
    expect(seeded.items[0]).toMatchObject({ currencyCode: "EUR", paymentStatus: "PARTIALLY_PAID", overdue: true }); // due 2026-11-01, 20 of 67.68 paid
    const methods = await (await api.get("/api/payments?method=BANK_TRANSFER&currency=ALL&pageSize=100", manager)).json();
    expect(methods.items.every((x: { method: string; currencyCode: string }) => x.method === "BANK_TRANSFER" && x.currencyCode === "ALL")).toBe(true);
  });
});
