import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { collectionsQuery, collectionsReport, dashboardQuery, dashboardSummary, receivablesQuery, receivablesReport, salesBreakdown, salesReportQuery } from "@/server/services/reports";
import { createOrder, db, errorCode, freshNipt, invoiceOrder, MANAGER, NIPT, principalFor, REP_KORCE, REP_TIRANA } from "../support/fixtures";

/**
 * Reporting against the real database. Every scenario uses its own calendar
 * window (2024–2025) that no other test touches, so the expected sums are exact.
 */

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const r2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const MARCH = { period: "custom", from: "2024-03-01", to: "2024-03-31" } as const;
const sales = (p: Awaited<ReturnType<typeof principalFor>>, extra: Record<string, unknown> = {}) => salesBreakdown(p, salesReportQuery.parse({ ...MARCH, ...extra }));

async function pay(invoiceId: string, amount: string, date: string) {
  const inv = await db().invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  return db().payment.create({ data: { invoiceId, amount, currencyCode: inv.currencyCode, paymentDate: new Date(date + "T00:00:00Z"), method: "BANK_TRANSFER", reference: "RPT" } });
}

// March 2024 scenario (rep.korce's customer Restorant Liqeni unless noted).
let A: Awaited<ReturnType<typeof invoiceOrder>>; // ALL 960.00, paid 300 on 15 Mar
let B: Awaited<ReturnType<typeof invoiceOrder>>; // EUR at 97.5, paid 5.00 on 2 Apr
let C: Awaited<ReturnType<typeof invoiceOrder>>; // USD at 91.3, cancelled
let R: Awaited<ReturnType<typeof invoiceOrder>>; // replacement of C, 20 Mar
let E: Awaited<ReturnType<typeof invoiceOrder>>; // ALL, 28 Feb (previous period)
let T: Awaited<ReturnType<typeof invoiceOrder>>; // rep.tirana's Market Alba, 11 Mar
let pipelineOrder: Awaited<ReturnType<typeof createOrder>>;

beforeAll(async () => {
  const a = await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-03-01", lines: [{ sku: "DRK-001", qty: "10" }] });
  A = await invoiceOrder(a.id, { issueDate: "2024-03-05", dueDate: "2024-04-05" });
  await pay(A.id, "300.00", "2024-03-15");
  const b = await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-03-02", currency: "EUR", rate: "97.5", lines: [{ sku: "DRK-002", qty: "7", discount: "12.5" }] });
  B = await invoiceOrder(b.id, { issueDate: "2024-03-10", dueDate: "2024-03-31" });
  await pay(B.id, "5.00", "2024-04-02");
  const c = await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-03-03", currency: "USD", rate: "91.3", lines: [{ sku: "FOD-002", qty: "13" }] });
  C = await invoiceOrder(c.id, { issueDate: "2024-03-12", dueDate: "2024-04-12" });
  await db().invoice.update({ where: { id: C.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Report test" } });
  R = await invoiceOrder(c.id, { replaces: C.id, issueDate: "2024-03-20", dueDate: "2024-04-20" });
  const e = await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-02-20" });
  E = await invoiceOrder(e.id, { issueDate: "2024-02-28", dueDate: "2024-03-28" });
  const t = await createOrder({ nipt: NIPT.marketAlba, orderDate: "2024-03-04", lines: [{ sku: "FOD-001", qty: "4" }] });
  T = await invoiceOrder(t.id, { issueDate: "2024-03-11", dueDate: "2024-04-11" });
  pipelineOrder = await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-03-25", currency: "EUR", rate: "100.25", lines: [{ sku: "DRK-001", qty: "3" }] });
  await createOrder({ nipt: NIPT.liqeni, orderDate: "2024-03-26", status: "DRAFT" });
});

const allEq = (inv: { taxableTotal: Prisma.Decimal; allPerUnit: Prisma.Decimal }) => r2(inv.taxableTotal.mul(inv.allPerUnit));

describe("invoiced sales", () => {
  it("counts issued invoices by issue date, converts at the stored rate, excludes cancelled, counts a replacement once", async () => {
    const m = await principalFor(MANAGER);
    const r = await sales(m);
    const expectedNet = [A, B, R, T].reduce((s, i) => s.plus(allEq(i)), D(0));
    expect(r.summary.invoiced).toMatchObject({ invoices: 4, net: expectedNet.toFixed(2) });
    const expectedGross = [A, B, R, T].reduce((s, i) => s.plus(r2(i.total.mul(i.allPerUnit))), D(0));
    expect(r.summary.invoiced.gross).toBe(expectedGross.toFixed(2));
    expect(allEq(B).toFixed(2)).not.toBe(B.taxableTotal.toFixed(2)); // B really was converted
  });

  it("a single-currency basis shows only that currency, in original amounts", async () => {
    const m = await principalFor(MANAGER);
    const eur = await sales(m, { basis: "EUR" });
    expect(eur.currency).toBe("EUR");
    expect(eur.summary.invoiced).toMatchObject({ invoices: 1, net: B.taxableTotal.toFixed(2), gross: B.total.toFixed(2) });
    const byCurrency = await sales(m, { groupBy: "currency" });
    const usd = byCurrency.items.find((x) => x.key === "USD")!;
    expect(usd).toMatchObject({ count: "1", gross: R.total.toFixed(2), grossAll: r2(R.total.mul(R.allPerUnit)).toFixed(2) });
  });

  it("groups by customer, product, category and trend with consistent totals", async () => {
    const m = await principalFor(MANAGER);
    const total = (await sales(m)).summary.invoiced.net;
    const byCustomer = await sales(m, { groupBy: "customer" });
    expect(byCustomer.items.map((x) => x.label).sort()).toEqual(["Market Alba SHPK", "Restorant Liqeni SHPK"]);
    expect(byCustomer.items.reduce((s, x) => s.plus(x.net), D(0)).toFixed(2)).toBe(total);
    const byProduct = await sales(m, { groupBy: "product" });
    expect(byProduct.items.find((x) => x.sub === "DRK-001")).toMatchObject({ count: "10", unit: "cope", net: "800.00" });
    // Line-level conversion may differ from invoice-level conversion by rounding cents only.
    const productSum = byProduct.items.reduce((s, x) => s.plus(x.net), D(0));
    expect(productSum.minus(total).abs().lte("0.05")).toBe(true);
    const byCategory = await sales(m, { groupBy: "category" });
    expect(byCategory.items.length).toBeGreaterThan(0);
    const trend = await sales(m, { groupBy: "trend", pageSize: 100 });
    expect(trend.trendUnit).toBe("day");
    expect(trend.total).toBe(31);
    expect(trend.items.find((x) => x.key === "2024-03-12")?.net).toBe("0.00"); // cancelled C's day
    expect(trend.items.find((x) => x.key === "2024-03-20")?.net).toBe(allEq(R).toFixed(2));
    expect(trend.items.reduce((s, x) => s.plus(x.net), D(0)).toFixed(2)).toBe(total);
    const yearly = await salesBreakdown(m, salesReportQuery.parse({ period: "custom", from: "2024-01-01", to: "2024-12-31", groupBy: "trend" }));
    expect(yearly.trendUnit).toBe("month");
    expect(yearly.items).toHaveLength(12);
  });

  it("paginates breakdown rows", async () => {
    const m = await principalFor(MANAGER);
    const first = await sales(m, { groupBy: "trend", pageSize: 10, page: 1 });
    const last = await sales(m, { groupBy: "trend", pageSize: 10, page: 4 });
    expect([first.items.length, last.items.length, first.pages]).toEqual([10, 1, 4]);
    expect(last.items[0].key).toBe("2024-03-31");
  });
});

describe("collections, receivables and pipeline", () => {
  it("payments collected use payment dates and the invoice's rate", async () => {
    const m = await principalFor(MANAGER);
    expect((await sales(m)).summary.collected).toEqual({ payments: 1, amount: "300.00" }); // B's payment is in April
    const april = await collectionsReport(m, collectionsQuery.parse({ period: "custom", from: "2024-04-01", to: "2024-04-30", groupBy: "currency" }));
    expect(april.summary).toEqual({ payments: 1, amount: r2(D("5.00").mul(B.allPerUnit)).toFixed(2) });
    expect(april.items[0]).toMatchObject({ key: "EUR", count: 1, amount: "487.50", amountAll: "487.50" });
    const eurOnly = await collectionsReport(m, collectionsQuery.parse({ period: "custom", from: "2024-04-01", to: "2024-04-30", basis: "EUR" }));
    expect(eurOnly.summary.amount).toBe("5.00");
  });

  it("pipeline is confirmed, not-yet-invoiced orders by order date, never sales", async () => {
    const m = await principalFor(MANAGER);
    const r = await sales(m);
    expect(r.summary.pipeline).toEqual({ orders: 1, value: r2(pipelineOrder.grandTotal.mul("100.25")).toFixed(2) });
    expect(r.summary.invoiced.invoices).toBe(4); // the pipeline order adds nothing to sales
  });

  it("receivables: outstanding and overdue as of a date, with aging", async () => {
    const m = await principalFor(MANAGER);
    const liqeni = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.liqeni } });
    const q = receivablesQuery.parse({ customerId: liqeni.id, pageSize: 100 });
    const asOf = "2024-04-10";
    const r = await receivablesReport(m, q, asOf);
    const ids = r.items.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining([A.id, B.id, R.id, E.id]));
    expect(ids).not.toContain(C.id);
    const a = r.items.find((x) => x.id === A.id)!;
    expect(a).toMatchObject({ outstanding: "660.00", outstandingAll: "660.00", daysOverdue: 5 });
    const b = r.items.find((x) => x.id === B.id)!;
    expect(b.outstanding).toBe(B.total.minus(5).toFixed(2));
    expect(b.outstandingAll).toBe(r2(B.total.minus(5).mul(B.allPerUnit)).toFixed(2));
    const overdueOnly = await receivablesReport(m, receivablesQuery.parse({ customerId: liqeni.id, overdueOnly: "true", pageSize: 100 }), asOf);
    expect(overdueOnly.items.map((x) => x.id)).not.toContain(R.id); // due 20 Apr
    expect(overdueOnly.items.every((x) => x.daysOverdue > 0)).toBe(true);
    const aging = r.summary.aging.reduce((s, x) => s.plus(x.amount), D(0));
    expect(aging.toFixed(2)).toBe(r.summary.outstanding);
  });
});

describe("dashboard", () => {
  it("summarises the period with comparisons, statuses and top lists", async () => {
    const m = await principalFor(MANAGER);
    const d = await dashboardSummary(m, dashboardQuery.parse(MARCH), "2024-04-10");
    expect(d.kpis.invoicedNet.value).toBe((await sales(m)).summary.invoiced.net);
    expect(d.kpis.invoicedNet.previous).toBe(allEq(E).toFixed(2)); // 30 Jan – 29 Feb
    const byStatus = Object.fromEntries(d.ordersByStatus.map((s) => [s.status, s.count]));
    expect(byStatus).toMatchObject({ DRAFT: 1, CONFIRMED: 5 }); // A, B, C, T and the pipeline order; E is February
    expect(d.kpis.orders.value).toBe(6);
    expect(d.months).toHaveLength(3);
    expect(d.months[2].net).toBe(d.kpis.invoicedNet.value);
    expect(d.topCustomers[0].name).toBe("Restorant Liqeni SHPK");
    expect(d.topProducts.map((x) => x.name)).toContain("Uje mineral 1.5L");
    expect(d.reps.map((x) => x.name).sort()).toEqual(["Erion Hoxha", "Mira Leka"]);
    expect(d.paymentStatus.map((x) => x.bucket)).toEqual(["PAID", "PARTIALLY_PAID", "UNPAID", "OVERDUE"]);
  });

  it("an empty period returns zeros, not errors", async () => {
    const m = await principalFor(MANAGER);
    const d = await dashboardSummary(m, dashboardQuery.parse({ period: "custom", from: "2019-01-01", to: "2019-01-31" }), "2019-02-01");
    expect(d.kpis.invoicedNet).toMatchObject({ value: "0.00", invoices: 0 });
    expect(d.kpis.orders.value).toBe(0);
    expect(d.kpis.pipeline).toEqual({ orders: 0, value: "0.00" });
    expect(d.topProducts).toEqual([]);
    expect(d.months).toEqual([{ month: "2019-01", net: "0.00", partial: false }]);
    const empty = await salesBreakdown(m, salesReportQuery.parse({ period: "custom", from: "2019-01-01", to: "2019-01-31", groupBy: "customer" }));
    expect([empty.items, empty.total]).toEqual([[], 0]);
  });

  it("validates periods", () => {
    expect(dashboardQuery.safeParse({ period: "custom", from: "2024-03-01" }).success).toBe(false);
    expect(dashboardQuery.safeParse({ period: "custom", from: "2024-03-02", to: "2024-03-01" }).success).toBe(false);
    expect(dashboardQuery.safeParse({ period: "custom", from: "2000-01-01", to: "2024-03-01" }).success).toBe(false);
    expect(dashboardQuery.safeParse({ period: "quarter" }).success).toBe(false);
    expect(salesReportQuery.safeParse({ groupBy: "invoice_number; DROP TABLE x" }).success).toBe(false);
  });
});

describe("representatives", () => {
  it("credit the representative on the order, even after the customer is reassigned", async () => {
    const m = await principalFor(MANAGER);
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const liqeni = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.liqeni } });
    const before = await sales(m, { groupBy: "rep" });
    await db().customer.update({ where: { id: liqeni.id }, data: { assignedRepId: tirana.employeeId } });
    try {
      const after = await sales(m, { groupBy: "rep" });
      expect(after.items).toEqual(before.items);
      // Rep Tirana now sees Liqeni's invoices (their customer), still credited to Mira Leka.
      const tiranaView = await sales(tirana, { groupBy: "rep" });
      expect(tiranaView.items.map((x) => x.label).sort()).toEqual(["Erion Hoxha", "Mira Leka"]);
      // Rep Korçë still sees the sales they made.
      expect((await sales(korce)).summary.invoiced.invoices).toBe(3);
    } finally {
      await db().customer.update({ where: { id: liqeni.id }, data: { assignedRepId: korce.employeeId } });
    }
  });

  it("see only their scope in every report", async () => {
    const tirana = await principalFor(REP_TIRANA);
    const korce = await principalFor(REP_KORCE);
    const t = await sales(tirana, { groupBy: "customer" });
    expect(t.items.map((x) => x.label)).toEqual(["Market Alba SHPK"]);
    expect(t.summary.invoiced.net).toBe(allEq(T).toFixed(2));
    const k = await sales(korce, { groupBy: "customer" });
    expect(k.items.map((x) => x.label)).toEqual(["Restorant Liqeni SHPK"]);
    const d = await dashboardSummary(tirana, dashboardQuery.parse(MARCH), "2024-04-10");
    expect(d.topCustomers.map((x) => x.name)).toEqual(["Market Alba SHPK"]);
    expect(d.reps.map((x) => x.name)).toEqual(["Erion Hoxha"]);
    const liqeni = await db().customer.findUniqueOrThrow({ where: { nipt: NIPT.liqeni } });
    expect((await receivablesReport(tirana, receivablesQuery.parse({ customerId: liqeni.id }))).total).toBe(0);
    expect((await collectionsReport(tirana, collectionsQuery.parse(MARCH))).summary.payments).toBe(0);
    expect((await collectionsReport(korce, collectionsQuery.parse(MARCH))).summary.payments).toBe(1);
  });
});

describe("historical stability", () => {
  it("later catalogue prices and exchange rates never change reported figures", async () => {
    const m = await principalFor(MANAGER);
    const before = JSON.stringify((await sales(m, { groupBy: "product" })).items);
    const p = await db().product.findUniqueOrThrow({ where: { sku: "DRK-002" } });
    await db().product.update({ where: { id: p.id }, data: { defaultNetAll: p.defaultNetAll.mul(4) } });
    const rate = await db().exchangeRate.create({ data: { currencyCode: "EUR", allPerUnit: "250", effectiveAt: new Date("2024-03-05T12:34:56Z") } });
    try {
      expect(JSON.stringify((await sales(m, { groupBy: "product" })).items)).toBe(before);
    } finally {
      await db().product.update({ where: { id: p.id }, data: { defaultNetAll: p.defaultNetAll } });
      await db().$executeRaw`DELETE FROM exchange_rates WHERE id = ${rate.id}::uuid`;
    }
  });
});

describe("large dataset", () => {
  it("aggregates hundreds of invoices in the database, exactly", async () => {
    const m = await principalFor(MANAGER);
    const nipt = freshNipt();
    const rep = await db().employee.findFirstOrThrow({ where: { user: { email: REP_KORCE } } });
    await db().customer.create({ data: { businessName: "Load Test " + nipt, nipt, businessType: "OTHER", city: "Tirane", assignedRepId: rep.id } });
    const N = 400;
    const rates = ["1", "97.3", "91.75"];
    const currencies = ["ALL", "EUR", "USD"] as const;
    const created: Awaited<ReturnType<typeof invoiceOrder>>[] = [];
    for (let i = 0; i < N; i += 20) {
      created.push(
        ...(await Promise.all(
          Array.from({ length: 20 }, async (_, j) => {
            const k = i + j;
            const day = String(1 + (k % 28)).padStart(2, "0");
            const o = await createOrder({ nipt, orderDate: `2025-02-${day}`, currency: currencies[k % 3], rate: rates[k % 3], lines: [{ sku: "DRK-001", qty: String(1 + (k % 9)), discount: String(k % 7) }] });
            return invoiceOrder(o.id, { issueDate: `2025-02-${day}`, dueDate: "2025-03-31" });
          }),
        )),
      );
    }
    const expected = created.reduce((s, i) => s.plus(allEq(i)), D(0)).toFixed(2);
    const t0 = performance.now();
    const r = await salesBreakdown(m, salesReportQuery.parse({ period: "custom", from: "2025-02-01", to: "2025-02-28", groupBy: "customer" }));
    const d = await dashboardSummary(m, dashboardQuery.parse({ period: "custom", from: "2025-02-01", to: "2025-02-28" }), "2025-03-01");
    const ms = performance.now() - t0;
    expect(r.summary.invoiced).toMatchObject({ invoices: N, net: expected });
    expect(r.items[0]).toMatchObject({ count: String(N), net: expected });
    expect(d.kpis.invoicedNet.value).toBe(expected);
    expect(ms).toBeLessThan(3000);
    console.info(`  (${N} invoices: sales breakdown + dashboard in ${Math.round(ms)} ms)`);
  });
});

it("rejects reports for users without the permission (none today) and unknown errors stay typed", async () => {
  // Every role holds reports.view; make sure the check itself is wired.
  const m = await principalFor(MANAGER);
  expect(await errorCode(salesBreakdown({ ...m, role: "NOPE" as never }, salesReportQuery.parse({})))).toBe("FORBIDDEN");
});
