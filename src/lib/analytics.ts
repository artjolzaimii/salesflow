/**
 * Dashboard and report aggregations (prototype `renderVals`).
 *
 * Pure functions over typed records, so the same logic can move server-side
 * behind GET /api/dashboard/summary and GET /api/reports/sales. Foreign-currency
 * amounts are converted to ALL only at the rate recorded on each invoice.
 */
import { addDays, daysBetween, formatDate, formatMoney, lineTotals, toAllEquivalent } from "./money";
import type { Currency, Customer, Employee, Invoice, InvoiceView, Order, PaymentStatus, Product, Totals } from "./types";

type Amountish = Pick<Invoice, "currency" | "exchangeRate"> & Totals;

export const sumAll = (rows: Amountish[], key: keyof Totals) => rows.reduce((a, r) => a + toAllEquivalent(r[key], r), 0);

export interface Delta {
  pct: number;
  text: string;
  label: string;
}

function delta(current: number, previous: number, label: string): Delta | null {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { pct, text: (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%", label };
}

/** First day of today's month and the same day-span last month (e.g. 1–16 Nov vs 1–16 Oct). */
export function monthToDate(today: string) {
  const start = today.slice(0, 8) + "01";
  const prevStart = addDays(start, -1).slice(0, 8) + "01";
  const prevEnd = addDays(prevStart, daysBetween(start, today));
  const day = Number(today.slice(8));
  const month = (iso: string) => formatDate(iso).split(" ")[1];
  return {
    start,
    prevStart,
    prevEnd,
    label: `1–${day} ${month(today)}`,
    prevLabel: `1–${day} ${month(prevStart)}`,
  };
}

export interface DashboardSummary {
  period: ReturnType<typeof monthToDate>;
  kpis: {
    invoicedNet: { value: number; delta: Delta | null };
    orders: { value: number; delta: Delta | null };
    activeCustomers: { value: number; orderedThisMonth: number };
    receivables: { value: number; open: number; overdue: number };
  };
  /** Net invoiced revenue per month in ALL cents; last entry is month to date. */
  months: { label: string; value: number }[];
  repBars: { name: string; value: number }[];
  distribution: { status: PaymentStatus; count: number; amount: number; share: number }[];
  topProducts: { name: string; quantity: string; value: number }[];
  topCustomers: { id: string; name: string; city: string; value: number }[];
}

export function dashboardSummary(args: {
  today: string;
  invoices: InvoiceView[];
  orders: Order[];
  allOrders: Order[];
  customers: Customer[];
  products: Product[];
  employees: Employee[];
  /** Jan…previous month history, ALL cents (fixture series in preview). */
  history: number[];
}): DashboardSummary {
  const { today, invoices, orders, allOrders, customers, products, employees, history } = args;
  const period = monthToDate(today);
  const thisMonth = invoices.filter((i) => i.issueDate >= period.start);
  const lastMonth = invoices.filter((i) => i.issueDate >= period.prevStart && i.issueDate <= period.prevEnd);
  const ordersNow = orders.filter((o) => o.date >= period.start && o.status !== "Cancelled");
  const ordersPrev = orders.filter((o) => o.date >= period.prevStart && o.date <= period.prevEnd && o.status !== "Cancelled");
  const open = invoices.filter((i) => i.outstanding > 0);

  const netNow = sumAll(thisMonth, "taxable");
  const monthIndex = Number(today.slice(5, 7)) - 1;
  const MS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = [...history, netNow].map((value, i) => ({ label: i === monthIndex ? MS[i] + "*" : MS[i], value }));

  const repBars = employees
    .map((e) => ({ name: e.name, value: sumAll(thisMonth.filter((i) => i.repId === e.id), "taxable") }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const grandTotal = invoices.reduce((a, i) => a + toAllEquivalent(i.total, i), 0) || 1;
  const distribution = (["Paid", "Partial", "Unpaid", "Overdue"] as PaymentStatus[]).map((status) => {
    const rows = invoices.filter((i) => i.status === status);
    const amount = rows.reduce((a, i) => a + toAllEquivalent(i.total, i), 0);
    return { status, count: rows.length, amount, share: (amount / grandTotal) * 100 };
  });

  const byProduct: Record<string, { name: string; unit: string; q: number; v: number }> = {};
  thisMonth.forEach((inv) => {
    const order = allOrders.find((o) => o.id === inv.orderId);
    order?.items.forEach((it) => {
      const p = products.find((x) => x.id === it.productId);
      if (!p) return;
      const agg = (byProduct[p.id] ??= { name: p.name, unit: p.unit, q: 0, v: 0 });
      agg.q += it.quantity;
      agg.v += toAllEquivalent(lineTotals(it, p.vatRate).taxable, inv);
    });
  });
  const topProducts = Object.values(byProduct)
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .map((a) => ({ name: a.name, quantity: a.q.toLocaleString("en-US") + " " + a.unit, value: a.v }));

  const byCustomer: Record<string, number> = {};
  thisMonth.forEach((i) => (byCustomer[i.customerId] = (byCustomer[i.customerId] || 0) + toAllEquivalent(i.taxable, i)));
  const topCustomers = Object.entries(byCustomer)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, value]) => {
      const c = customers.find((x) => x.id === id);
      return { id, name: c?.name ?? id, city: c?.city ?? "", value };
    });

  return {
    period,
    kpis: {
      invoicedNet: { value: netNow, delta: delta(netNow, sumAll(lastMonth, "taxable"), "vs " + period.prevLabel) },
      orders: { value: ordersNow.length, delta: delta(ordersNow.length, ordersPrev.length, "vs " + period.prevLabel) },
      activeCustomers: { value: customers.filter((c) => c.active).length, orderedThisMonth: new Set(ordersNow.map((o) => o.customerId)).size },
      receivables: {
        value: open.reduce((a, i) => a + toAllEquivalent(i.outstanding, i), 0),
        open: open.length,
        overdue: open.filter((i) => i.status === "Overdue").length,
      },
    },
    months,
    repBars,
    distribution,
    topProducts,
    topCustomers,
  };
}

/* ---------- sales report ---------- */

export type ReportGroup = "rep" | "customer" | "product" | "currency" | "outstanding";
export type ReportCurrency = Currency | "ALL_EQ";

export interface ReportResult {
  invoiceCount: number;
  reportCurrency: Currency;
  summary: { label: string; value: string }[];
  columns: { title: string; align: "left" | "right" }[];
  rows: { key: string; cells: string[]; share: number }[];
  showShare: boolean;
  basis: string;
}

export function salesReport(args: {
  invoices: InvoiceView[];
  allOrders: Order[];
  products: Product[];
  customerById: Record<string, Customer>;
  repName: (id: string) => string;
  from: string;
  to: string;
  group: ReportGroup;
  currency: ReportCurrency;
  today: string;
}): ReportResult {
  const { invoices, allOrders, products, customerById, repName, from, to, group, currency, today } = args;
  const convert = currency === "ALL_EQ";
  const rc: Currency = convert ? "ALL" : currency;
  const val = (amount: number, inv: Invoice) => (convert ? toAllEquivalent(amount, inv) : amount);
  const inRange = invoices.filter((i) => i.issueDate >= from && i.issueDate <= to && (convert || i.currency === currency));

  let columns: ReportResult["columns"];
  let rows: ReportResult["rows"];

  if (group === "outstanding") {
    columns = [
      { title: "Invoice", align: "left" },
      { title: "Customer", align: "left" },
      { title: "Due", align: "left" },
      { title: "Days overdue", align: "right" },
      { title: `Outstanding (${rc})`, align: "right" },
    ];
    rows = inRange
      .filter((i) => i.outstanding > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((i) => {
        const days = Math.max(0, daysBetween(i.dueDate, today));
        return {
          key: i.id,
          share: 0,
          cells: [i.id, customerById[i.customerId].name, formatDate(i.dueDate), days ? String(days) : "—", formatMoney(val(i.outstanding, i))],
        };
      });
  } else {
    const agg: Record<string, { label: string; sub: string; n: number; net: number; vat: number; gross: number }> = {};
    const add = (key: string, label: string, sub: string, n: number, net: number, vat: number, gross: number) => {
      const a = (agg[key] ??= { label, sub, n: 0, net: 0, vat: 0, gross: 0 });
      a.n += n;
      a.net += net;
      a.vat += vat;
      a.gross += gross;
    };
    inRange.forEach((i) => {
      if (group === "product") {
        allOrders
          .find((o) => o.id === i.orderId)
          ?.items.forEach((it) => {
            const p = products.find((x) => x.id === it.productId);
            if (!p) return;
            const l = lineTotals(it, p.vatRate);
            add(p.id, p.name, p.sku, it.quantity, val(l.taxable, i), val(l.vat, i), val(l.total, i));
          });
        return;
      }
      const key = group === "rep" ? i.repId : group === "customer" ? i.customerId : i.currency;
      const label = group === "rep" ? repName(i.repId) : group === "customer" ? customerById[i.customerId].name : "Invoiced in " + i.currency;
      add(key, label, group === "customer" ? customerById[i.customerId].city : "", 1, val(i.taxable, i), val(i.vat, i), val(i.total, i));
    });
    const list = Object.entries(agg).sort((a, b) => b[1].net - a[1].net);
    const max = Math.max(1, ...list.map(([, a]) => a.net));
    const groupLabel = { rep: "Representative", customer: "Customer", product: "Product", currency: "Currency" }[group];
    columns = [
      { title: groupLabel, align: "left" },
      { title: group === "product" ? "Quantity" : "Invoices", align: "right" },
      { title: `Net (${rc})`, align: "right" },
      { title: "VAT", align: "right" },
      { title: "Gross", align: "right" },
    ];
    rows = list.map(([key, a]) => ({
      key,
      share: Math.round((a.net / max) * 100),
      cells: [a.label + (a.sub ? " · " + a.sub : ""), a.n.toLocaleString("en-US"), formatMoney(a.net), formatMoney(a.vat), formatMoney(a.gross)],
    }));
  }

  const total = (k: "taxable" | "vat" | "total" | "outstanding") => inRange.reduce((a, i) => a + val(i[k], i), 0);

  return {
    invoiceCount: inRange.length,
    reportCurrency: rc,
    summary: [
      { label: "Net sales", value: formatMoney(total("taxable"), rc) },
      { label: "VAT", value: formatMoney(total("vat"), rc) },
      { label: "Gross invoiced", value: formatMoney(total("total"), rc) },
      { label: "Outstanding", value: formatMoney(total("outstanding"), rc) },
    ],
    columns,
    rows,
    showShare: group !== "outstanding",
    basis: convert
      ? "Reporting currency: ALL. EUR and USD invoices are converted at the exchange rate recorded on each invoice; no current-rate revaluation."
      : `Showing ${currency} invoices only, in ${currency}. No conversion applied.`,
  };
}
