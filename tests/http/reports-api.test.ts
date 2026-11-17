import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { DEMO_PASSWORD } from "../support/env";
import { createOrder, db, invoiceOrder, MANAGER, NIPT, REP_KORCE, REP_TIRANA } from "../support/fixtures";
import { api, base, signIn } from "../support/http";

/** Phase 5E report endpoints over HTTP. Uses an August 2023 window no other test writes to. */
describe.skipIf(!base)("reporting APIs over HTTP", () => {
  let manager: string, tirana: string, korce: string;
  const AUG = "period=custom&from=2023-08-01&to=2023-08-31";
  let eurNetAll = "";
  let allNet = "";

  beforeAll(async () => {
    [manager, tirana, korce] = (await Promise.all([MANAGER, REP_TIRANA, REP_KORCE].map((e) => signIn(e, DEMO_PASSWORD)))) as string[];
    const a = await createOrder({ nipt: NIPT.marketAlba, orderDate: "2023-08-02", currency: "EUR", rate: "98.77", lines: [{ sku: "DRK-002", qty: "11", discount: "3" }] });
    const ia = await invoiceOrder(a.id, { issueDate: "2023-08-03", dueDate: "2023-09-03" });
    eurNetAll = ia.taxableTotal.mul(ia.allPerUnit).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
    const b = await createOrder({ nipt: NIPT.liqeni, orderDate: "2023-08-05" });
    allNet = (await invoiceOrder(b.id, { issueDate: "2023-08-06", dueDate: "2023-09-06" })).taxableTotal.toFixed(2);
  });

  it("answers 401 without a session", async () => {
    for (const path of ["/api/reports/dashboard", "/api/reports/sales", "/api/reports/collections", "/api/reports/receivables"]) {
      const res = await api.get(path);
      expect(res.status, path).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("validates periods, groupings and bases with 422", async () => {
    for (const path of [
      "/api/reports/dashboard?period=custom&from=2023-08-01",
      "/api/reports/dashboard?period=custom&from=2023-08-31&to=2023-08-01",
      "/api/reports/dashboard?period=quarter",
      "/api/reports/sales?groupBy=invoice_number",
      "/api/reports/sales?basis=GBP",
      "/api/reports/sales?pageSize=1000",
      "/api/reports/collections?groupBy=product",
      "/api/reports/receivables?overdueOnly=maybe",
    ]) {
      expect((await api.get(path, manager)).status, path).toBe(422);
    }
  });

  it("returns exact decimal strings, converted at the stored rate", async () => {
    const r = await (await api.get(`/api/reports/sales?${AUG}&groupBy=customer`, manager)).json();
    expect(r).toMatchObject({ currency: "ALL", basis: "ALL_EQ", groupBy: "customer", period: { from: "2023-08-01", to: "2023-08-31" } });
    const byName = Object.fromEntries(r.items.map((x: { label: string; net: string }) => [x.label, x.net]));
    expect(byName).toEqual({ "Market Alba SHPK": eurNetAll, "Restorant Liqeni SHPK": allNet });
    const total = new Prisma.Decimal(eurNetAll).plus(allNet).toFixed(2);
    expect(r.summary.invoiced).toMatchObject({ invoices: 2, net: total });
    const eur = await (await api.get(`/api/reports/sales?${AUG}&basis=EUR&groupBy=currency`, manager)).json();
    expect(eur.items).toHaveLength(1);
    expect(eur.items[0].key).toBe("EUR");
    const dash = await (await api.get(`/api/reports/dashboard?${AUG}`, manager)).json();
    expect(dash.kpis.invoicedNet.value).toBe(total);
    expect(dash.months).toHaveLength(8);
    expect(dash.months[7].net).toBe(total);
  });

  it("scopes every report to the representative", async () => {
    const t = await (await api.get(`/api/reports/sales?${AUG}&groupBy=customer`, tirana)).json();
    expect(t.items.map((x: { label: string }) => x.label)).toEqual(["Market Alba SHPK"]);
    expect(t.summary.invoiced.net).toBe(eurNetAll);
    const k = await (await api.get(`/api/reports/dashboard?${AUG}`, korce)).json();
    expect(k.kpis.invoicedNet.value).toBe(allNet);
    expect(k.topCustomers.map((x: { name: string }) => x.name)).toEqual(["Restorant Liqeni SHPK"]);
    const rec = await (await api.get("/api/reports/receivables?pageSize=100", tirana)).json();
    expect(rec.items.every((x: { customer: { businessName: string } }) => !["Restorant Liqeni SHPK", "Hotel Korca SHPK"].includes(x.customer.businessName))).toBe(true);
  });

  it("serves the default dashboard (this month) and the other report kinds", async () => {
    const dash = await api.get("/api/reports/dashboard", manager);
    expect(dash.status).toBe(200);
    const d = await dash.json();
    expect(d.period.preset).toBe("month");
    expect(d.period.from.endsWith("-01")).toBe(true);
    expect(d.kpis.receivables.outstanding).toMatch(/^\d+\.\d{2}$/);
    expect(d.recent.orders.length).toBeGreaterThan(0);
    for (const preset of ["today", "week", "year"]) expect((await api.get(`/api/reports/dashboard?period=${preset}`, manager)).status).toBe(200);
    const col = await api.get("/api/reports/collections?period=year&groupBy=method", manager);
    expect(col.status).toBe(200);
    const adriatik = (await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.adriatik } })).id;
    const rec = await (await api.get(`/api/reports/receivables?overdueOnly=true&customerId=${adriatik}&pageSize=100`, manager)).json();
    expect(rec.items.every((x: { daysOverdue: number }) => x.daysOverdue > 0)).toBe(true);
    expect(rec.items.map((x: { invoiceNumber: string }) => x.invoiceNumber)).toContain("INV-2026-002"); // seeded, due 1 Nov 2026
  });
});
