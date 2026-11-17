import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { businessDate, ymd } from "@/lib/business-date";
import { CURRENCY_CODES } from "@/lib/labels";
import { MAX_CUSTOM_DAYS, PERIODS, daysInclusive, resolvePeriod, shiftDays, type ResolvedPeriod } from "@/lib/report-period";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { customerScope, orderScopeSql } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { D } from "@/server/domain/money";
import { paged } from "@/server/query";

/**
 * Central reporting service. Every dashboard and report figure comes from here;
 * the definitions are documented in docs/reporting.md.
 *
 * Metrics and the date that places a record in a period:
 * - Invoiced sales      ISSUED invoices, by invoice issue date. Net = taxable total
 *                       (after discounts, before VAT); gross = invoice total.
 *                       Cancelled invoices never count; a replacement counts once,
 *                       on its own issue date (its cancelled predecessor is excluded).
 * - Payments collected  payments, by payment date.
 * - Outstanding         ISSUED invoices' total − payments, as of today (not period-bound).
 * - Overdue             outstanding with due date before today.
 * - Order pipeline      CONFIRMED / PROCESSING / DELIVERED orders without an ISSUED
 *                       invoice, by order date. Never counted as sales.
 *
 * Currency: ALL is the reporting currency. EUR/USD amounts are converted with the
 * rate stored on the invoice (payments use their invoice's rate; the pipeline uses
 * the order's rate), never a current rate: ROUND(amount × all_per_unit, 2) per
 * record (PostgreSQL ROUND = half away from zero = HALF_UP for these non-negative
 * amounts), then summed. With a single-currency basis (ALL, EUR or USD) only that
 * currency's records are included, in original amounts.
 *
 * Why SQL: these are GROUP BY / SUM aggregations over invoices, payments and
 * order lines that Prisma's query API can't express without loading every row
 * into memory. Every query is a Prisma.sql tagged template: values are bound
 * parameters, and the only interpolated fragments are fixed constants chosen
 * from allowlisted enum values. Representative scope is orderScopeSql(), the same
 * rule as the Prisma scope filters.
 */

export const REPORT_BASES = ["ALL_EQ", "ALL", "EUR", "USD"] as const;
export type ReportBasis = (typeof REPORT_BASES)[number];

const periodFields = {
  period: z.enum(PERIODS).default("month"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};

function checkCustom(v: { period: string; from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (v.period !== "custom") return;
  if (!v.from) ctx.addIssue({ code: "custom", path: ["from"], message: "Choose a start date." });
  if (!v.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Choose an end date." });
  if (v.from && v.to && v.from > v.to) ctx.addIssue({ code: "custom", path: ["to"], message: "The end date can't be before the start date." });
  if (v.from && v.to && v.from <= v.to && daysInclusive(v.from, v.to) > MAX_CUSTOM_DAYS) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "Choose a range of at most 10 years." });
  }
}

export const dashboardQuery = z.object(periodFields).superRefine(checkCustom);

export const SALES_GROUPS = ["trend", "customer", "product", "category", "rep", "currency"] as const;
export const salesReportQuery = z
  .object({
    ...periodFields,
    groupBy: z.enum(SALES_GROUPS).default("rep"),
    basis: z.enum(REPORT_BASES).default("ALL_EQ"),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine(checkCustom);

export const COLLECTION_GROUPS = ["trend", "method", "currency", "customer"] as const;
export const collectionsQuery = z
  .object({
    ...periodFields,
    groupBy: z.enum(COLLECTION_GROUPS).default("trend"),
    basis: z.enum(REPORT_BASES).default("ALL_EQ"),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine(checkCustom);

export const receivablesQuery = z.object({
  overdueOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  basis: z.enum(REPORT_BASES).default("ALL_EQ"),
  currency: z.enum(CURRENCY_CODES).optional(),
  customerId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

type PeriodInput = { period: (typeof PERIODS)[number]; from?: string; to?: string };

export function periodFor(q: PeriodInput, today = businessDate()): ResolvedPeriod {
  return resolvePeriod(q.period, today, q.period === "custom" ? { from: q.from!, to: q.to! } : undefined);
}

/* ------------------------------------------------------------ helpers */

const money = (v: Prisma.Decimal | string | number | null | undefined) => D(v ?? 0).toFixed(2);
const int = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Amount in the report basis: ROUND(x × rate, 2) for ALL equivalents, else the original amount. */
function amount(basis: ReportBasis, col: Prisma.Sql, rate: Prisma.Sql): Prisma.Sql {
  return basis === "ALL_EQ" ? Prisma.sql`ROUND(${col} * ${rate}, 2)` : col;
}
const currencyFilter = (basis: ReportBasis, col: Prisma.Sql) => (basis === "ALL_EQ" ? Prisma.sql`TRUE` : Prisma.sql`${col} = ${basis}`);
const reportCurrency = (basis: ReportBasis) => (basis === "ALL_EQ" ? "ALL" : basis);

/** Joins and conditions for ISSUED invoices issued in [from, to], within the caller's scope. */
function issuedInvoices(p: Principal, from: string, to: string, basis: ReportBasis) {
  return Prisma.sql`
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE i.status = 'ISSUED'
      AND i.issue_date BETWEEN ${from}::date AND ${to}::date
      AND ${orderScopeSql(p)}
      AND ${currencyFilter(basis, Prisma.sql`i.currency_code`)}`;
}

/** Orders dated in [from, to] (order_date is a timestamp at the business day's midnight UTC). */
const orderDateIn = (from: string, to: string) => Prisma.sql`o.order_date >= ${from}::date AND o.order_date < (${to}::date + 1)`;

/** Trend granularity: days for ranges up to 62 days, months beyond. */
export const trendUnit = (period: { from: string; to: string }) => (daysInclusive(period.from, period.to) <= 62 ? "day" : "month");

function trendBuckets(from: string, to: string, unit: "day" | "month"): string[] {
  const out: string[] = [];
  if (unit === "day") {
    for (let d = from; d <= to; d = shiftDays(d, 1)) out.push(d);
  } else {
    let [y, m] = from.split("-").map(Number);
    const end = to.slice(0, 7);
    for (;;) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      out.push(key + "-01");
      if (key >= end) break;
      m = m === 12 ? 1 : m + 1;
      if (m === 1) y++;
    }
  }
  return out;
}

/* ------------------------------------------------------------ metrics */

/** Invoiced sales in a period: count, net, VAT, gross. */
export async function invoicedSales(p: Principal, from: string, to: string, basis: ReportBasis) {
  const [r] = await getDb().$queryRaw<{ n: bigint; net: Prisma.Decimal | null; vat: Prisma.Decimal | null; gross: Prisma.Decimal | null }[]>`
    SELECT COUNT(*) AS n,
           SUM(${amount(basis, Prisma.sql`i.taxable_total`, Prisma.sql`i.all_per_unit`)}) AS net,
           SUM(${amount(basis, Prisma.sql`i.vat_total`, Prisma.sql`i.all_per_unit`)}) AS vat,
           SUM(${amount(basis, Prisma.sql`i.total`, Prisma.sql`i.all_per_unit`)}) AS gross
    ${issuedInvoices(p, from, to, basis)}`;
  return { invoices: int(r.n), net: money(r.net), vat: money(r.vat), gross: money(r.gross) };
}

/** Payments by payment date, converted at their invoice's stored rate. */
export async function paymentsCollected(p: Principal, from: string, to: string, basis: ReportBasis) {
  const [r] = await getDb().$queryRaw<{ n: bigint; amount: Prisma.Decimal | null }[]>`
    SELECT COUNT(*) AS n, SUM(${amount(basis, Prisma.sql`pay.amount`, Prisma.sql`i.all_per_unit`)}) AS amount
    FROM payments pay
    JOIN invoices i ON i.id = pay.invoice_id
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE pay.payment_date BETWEEN ${from}::date AND ${to}::date
      AND ${orderScopeSql(p)}
      AND ${currencyFilter(basis, Prisma.sql`i.currency_code`)}`;
  return { payments: int(r.n), amount: money(r.amount) };
}

/** Open balances of ISSUED invoices as of `today` (outstanding converted at the invoice rate). */
function openInvoicesCte(p: Principal, basis: ReportBasis, extra: Prisma.Sql = Prisma.sql`TRUE`) {
  return Prisma.sql`
    WITH open_invoices AS (
      SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.currency_code, i.all_per_unit, i.total,
             o.id AS order_id, o.order_number, o.sales_rep_id, c.id AS customer_id, c.business_name,
             i.total - COALESCE(paid.paid, 0) AS outstanding
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      -- Per-invoice sum via the (invoice_id, payment_date) index, only for the invoices in scope.
      CROSS JOIN LATERAL (SELECT SUM(x.amount) AS paid FROM payments x WHERE x.invoice_id = i.id) paid
      WHERE i.status = 'ISSUED'
        AND i.total - COALESCE(paid.paid, 0) > 0
        AND ${orderScopeSql(p)}
        AND ${currencyFilter(basis, Prisma.sql`i.currency_code`)}
        AND ${extra}
    )`;
}

export async function receivablesSummary(p: Principal, basis: ReportBasis, today = businessDate(), customerId?: string) {
  const extra = customerId ? Prisma.sql`c.id = ${customerId}::uuid` : Prisma.sql`TRUE`;
  const amt = amount(basis, Prisma.sql`outstanding`, Prisma.sql`all_per_unit`);
  const [r] = await getDb().$queryRaw<
    { n: bigint; total: Prisma.Decimal | null; overdue_n: bigint; overdue: Prisma.Decimal | null; d0: Prisma.Decimal | null; d30: Prisma.Decimal | null; d60: Prisma.Decimal | null; d90: Prisma.Decimal | null; d90p: Prisma.Decimal | null }[]
  >`${openInvoicesCte(p, basis, extra)}
    SELECT COUNT(*) AS n, SUM(${amt}) AS total,
           COUNT(*) FILTER (WHERE due_date < ${today}::date) AS overdue_n,
           SUM(${amt}) FILTER (WHERE due_date < ${today}::date) AS overdue,
           SUM(${amt}) FILTER (WHERE due_date >= ${today}::date) AS d0,
           SUM(${amt}) FILTER (WHERE ${today}::date - due_date BETWEEN 1 AND 30) AS d30,
           SUM(${amt}) FILTER (WHERE ${today}::date - due_date BETWEEN 31 AND 60) AS d60,
           SUM(${amt}) FILTER (WHERE ${today}::date - due_date BETWEEN 61 AND 90) AS d90,
           SUM(${amt}) FILTER (WHERE ${today}::date - due_date > 90) AS d90p
    FROM open_invoices`;
  return {
    asOf: today,
    openInvoices: int(r.n),
    outstanding: money(r.total),
    overdueInvoices: int(r.overdue_n),
    overdue: money(r.overdue),
    aging: [
      { bucket: "Not yet due", amount: money(r.d0) },
      { bucket: "1–30 days", amount: money(r.d30) },
      { bucket: "31–60 days", amount: money(r.d60) },
      { bucket: "61–90 days", amount: money(r.d90) },
      { bucket: "Over 90 days", amount: money(r.d90p) },
    ],
  };
}

/** Confirmed (incl. processing/delivered) orders not yet invoiced, by order date, at the order's stored rate. */
export async function orderPipeline(p: Principal, from: string, to: string, basis: ReportBasis) {
  const [r] = await getDb().$queryRaw<{ n: bigint; value: Prisma.Decimal | null }[]>`
    SELECT COUNT(*) AS n, SUM(${amount(basis, Prisma.sql`o.grand_total`, Prisma.sql`o.all_per_unit`)}) AS value
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('CONFIRMED', 'PROCESSING', 'DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM invoices x WHERE x.order_id = o.id AND x.status = 'ISSUED')
      AND ${orderDateIn(from, to)}
      AND ${orderScopeSql(p)}
      AND ${currencyFilter(basis, Prisma.sql`o.currency_code`)}`;
  return { orders: int(r.n), value: money(r.value) };
}

/** Orders by status (count and gross value in ALL at each order's rate), by order date. */
async function ordersByStatus(p: Principal, from: string, to: string) {
  const rows = await getDb().$queryRaw<{ status: string; n: bigint; value: Prisma.Decimal | null }[]>`
    SELECT o.status::text AS status, COUNT(*) AS n, SUM(ROUND(o.grand_total * o.all_per_unit, 2)) AS value
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE ${orderDateIn(from, to)} AND ${orderScopeSql(p)}
    GROUP BY o.status`;
  const by = new Map(rows.map((r) => [r.status, r]));
  return (["DRAFT", "CONFIRMED", "PROCESSING", "DELIVERED", "CANCELLED"] as const).map((status) => ({
    status,
    count: int(by.get(status)?.n),
    valueAll: money(by.get(status)?.value),
  }));
}

/* ---------------------------------------------------------- breakdowns */

interface GroupRow {
  key: string;
  label: string;
  sub: string | null;
  n: Prisma.Decimal | bigint | null;
  unit: string | null;
  net: Prisma.Decimal | null;
  vat: Prisma.Decimal | null;
  gross: Prisma.Decimal | null;
  gross_all: Prisma.Decimal | null;
  total_rows: bigint;
}

/** Invoiced sales grouped by customer, product, category, representative, currency or date bucket. */
export async function salesBreakdown(p: Principal, q: z.output<typeof salesReportQuery>, today = businessDate()) {
  assertPermission(p, "reports.view");
  const period = periodFor(q, today);
  const { from, to } = period;
  const b = q.basis;
  const INV = { taxable_total: Prisma.sql`i.taxable_total`, vat_total: Prisma.sql`i.vat_total`, total: Prisma.sql`i.total` };
  const LINE = { taxable_amount: Prisma.sql`oi.taxable_amount`, vat_amount: Prisma.sql`oi.vat_amount`, line_total: Prisma.sql`oi.line_total` };
  const inv = (col: keyof typeof INV) => amount(b, INV[col], Prisma.sql`i.all_per_unit`);
  const line = (col: keyof typeof LINE) => amount(b, LINE[col], Prisma.sql`i.all_per_unit`);
  const limit = Prisma.sql`LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
  const db = getDb();
  let rows: GroupRow[];

  switch (q.groupBy) {
    case "customer":
      rows = await db.$queryRaw<GroupRow[]>`
        SELECT c.id::text AS key, c.business_name AS label, c.city AS sub, COUNT(*) AS n, NULL AS unit,
               SUM(${inv("taxable_total")}) AS net, SUM(${inv("vat_total")}) AS vat, SUM(${inv("total")}) AS gross,
               SUM(ROUND(i.total * i.all_per_unit, 2)) AS gross_all, COUNT(*) OVER () AS total_rows
        ${issuedInvoices(p, from, to, b)}
        GROUP BY c.id, c.business_name, c.city ORDER BY net DESC, label ${limit}`;
      break;
    case "rep":
      // Attribution: the representative snapshotted on the order (orders.sales_rep_id), never the customer's current rep.
      rows = await db.$queryRaw<GroupRow[]>`
        SELECT e.id::text AS key, e.first_name || ' ' || e.last_name AS label, e.territory AS sub, COUNT(*) AS n, NULL AS unit,
               SUM(${inv("taxable_total")}) AS net, SUM(${inv("vat_total")}) AS vat, SUM(${inv("total")}) AS gross,
               SUM(ROUND(i.total * i.all_per_unit, 2)) AS gross_all, COUNT(*) OVER () AS total_rows
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        JOIN employees e ON e.id = o.sales_rep_id
        WHERE i.status = 'ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date
          AND ${orderScopeSql(p)} AND ${currencyFilter(b, Prisma.sql`i.currency_code`)}
        GROUP BY e.id, e.first_name, e.last_name, e.territory ORDER BY net DESC, label ${limit}`;
      break;
    case "currency":
      rows = await db.$queryRaw<GroupRow[]>`
        SELECT i.currency_code AS key, i.currency_code AS label, NULL AS sub, COUNT(*) AS n, NULL AS unit,
               SUM(i.taxable_total) AS net, SUM(i.vat_total) AS vat, SUM(i.total) AS gross,
               SUM(ROUND(i.total * i.all_per_unit, 2)) AS gross_all, COUNT(*) OVER () AS total_rows
        ${issuedInvoices(p, from, to, b)}
        GROUP BY i.currency_code ORDER BY gross_all DESC, label ${limit}`;
      break;
    case "product":
    case "category": {
      // Line-level: each order line of an issued invoice, converted at that invoice's rate.
      const key = q.groupBy === "product" ? Prisma.sql`pr.id::text` : Prisma.sql`cat.id::text`;
      const label = q.groupBy === "product" ? Prisma.sql`pr.name` : Prisma.sql`cat.name`;
      const sub = q.groupBy === "product" ? Prisma.sql`pr.sku` : Prisma.sql`NULL`;
      const unit = q.groupBy === "product" ? Prisma.sql`MIN(oi.unit)` : Prisma.sql`NULL`;
      const groupCols = q.groupBy === "product" ? Prisma.sql`pr.id, pr.name, pr.sku` : Prisma.sql`cat.id, cat.name`;
      rows = await db.$queryRaw<GroupRow[]>`
        SELECT ${key} AS key, ${label} AS label, ${sub} AS sub,
               ${q.groupBy === "product" ? Prisma.sql`SUM(oi.quantity)` : Prisma.sql`COUNT(DISTINCT i.id)`} AS n, ${unit} AS unit,
               SUM(${line("taxable_amount")}) AS net, SUM(${line("vat_amount")}) AS vat, SUM(${line("line_total")}) AS gross,
               SUM(ROUND(oi.line_total * i.all_per_unit, 2)) AS gross_all, COUNT(*) OVER () AS total_rows
        FROM invoices i
        JOIN orders o ON o.id = i.order_id
        JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products pr ON pr.id = oi.product_id
        JOIN categories cat ON cat.id = pr.category_id
        WHERE i.status = 'ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date
          AND ${orderScopeSql(p)} AND ${currencyFilter(b, Prisma.sql`i.currency_code`)}
        GROUP BY ${groupCols} ORDER BY net DESC, label ${limit}`;
      break;
    }
    case "trend": {
      const unit = trendUnit(period);
      const bucket = unit === "day" ? Prisma.sql`i.issue_date` : Prisma.sql`date_trunc('month', i.issue_date)::date`;
      const found = await db.$queryRaw<{ bucket: Date; n: bigint; net: Prisma.Decimal | null; vat: Prisma.Decimal | null; gross: Prisma.Decimal | null }[]>`
        SELECT ${bucket} AS bucket, COUNT(*) AS n, SUM(${inv("taxable_total")}) AS net, SUM(${inv("vat_total")}) AS vat, SUM(${inv("total")}) AS gross
        ${issuedInvoices(p, from, to, b)}
        GROUP BY 1`;
      const by = new Map(found.map((r) => [ymd(r.bucket), r]));
      const all = trendBuckets(from, to, unit);
      const slice = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
      rows = slice.map((k) => {
        const r = by.get(k);
        return { key: k, label: k, sub: unit, n: r?.n ?? BigInt(0), unit: null, net: r?.net ?? null, vat: r?.vat ?? null, gross: r?.gross ?? null, gross_all: null, total_rows: BigInt(all.length) };
      });
      break;
    }
  }

  const [summary, collected, pipeline, receivables] = await Promise.all([
    invoicedSales(p, from, to, b),
    paymentsCollected(p, from, to, b),
    orderPipeline(p, from, to, b),
    receivablesSummary(p, b, today),
  ]);
  const total = int(rows[0]?.total_rows);
  return {
    period,
    basis: b,
    currency: reportCurrency(b),
    groupBy: q.groupBy,
    trendUnit: q.groupBy === "trend" ? trendUnit(period) : null,
    summary: { invoiced: summary, collected, pipeline, receivables: { outstanding: receivables.outstanding, overdue: receivables.overdue, asOf: receivables.asOf } },
    ...paged(
      rows.map((r) => ({
        key: r.key,
        label: r.label,
        sub: r.sub,
        /** Invoices (customer, rep, currency, trend), distinct invoices (category) or quantity (product). */
        count: r.n === null ? "0" : typeof r.n === "bigint" ? String(r.n) : r.n.toString(),
        unit: r.unit,
        net: money(r.net),
        vat: money(r.vat),
        gross: money(r.gross),
        /** ALL equivalent of gross (currency grouping shows original amounts beside it). */
        grossAll: r.gross_all === null ? null : money(r.gross_all),
      })),
      total,
      q.page,
      q.pageSize,
    ),
  };
}

/** Payment collections grouped by date bucket, method, currency or customer (payment date in the period). */
export async function collectionsReport(p: Principal, q: z.output<typeof collectionsQuery>, today = businessDate()) {
  assertPermission(p, "reports.view");
  assertPermission(p, "payments.view");
  const period = periodFor(q, today);
  const { from, to } = period;
  const amt = amount(q.basis, Prisma.sql`pay.amount`, Prisma.sql`i.all_per_unit`);
  const unit = trendUnit(period);
  const group: Record<(typeof COLLECTION_GROUPS)[number], { key: Prisma.Sql; label: Prisma.Sql; cols: Prisma.Sql }> = {
    trend: unit === "day"
      ? { key: Prisma.sql`pay.payment_date::text`, label: Prisma.sql`pay.payment_date::text`, cols: Prisma.sql`pay.payment_date` }
      : { key: Prisma.sql`date_trunc('month', pay.payment_date)::date::text`, label: Prisma.sql`date_trunc('month', pay.payment_date)::date::text`, cols: Prisma.sql`date_trunc('month', pay.payment_date)` },
    method: { key: Prisma.sql`pay.method::text`, label: Prisma.sql`pay.method::text`, cols: Prisma.sql`pay.method` },
    currency: { key: Prisma.sql`i.currency_code`, label: Prisma.sql`i.currency_code`, cols: Prisma.sql`i.currency_code` },
    customer: { key: Prisma.sql`c.id::text`, label: Prisma.sql`c.business_name`, cols: Prisma.sql`c.id, c.business_name` },
  };
  const g = group[q.groupBy];
  const rows = await getDb().$queryRaw<{ key: string; label: string; n: bigint; amount: Prisma.Decimal | null; amount_all: Prisma.Decimal | null; total_rows: bigint }[]>`
    SELECT ${g.key} AS key, ${g.label} AS label, COUNT(*) AS n, SUM(${amt}) AS amount,
           SUM(ROUND(pay.amount * i.all_per_unit, 2)) AS amount_all, COUNT(*) OVER () AS total_rows
    FROM payments pay
    JOIN invoices i ON i.id = pay.invoice_id
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE pay.payment_date BETWEEN ${from}::date AND ${to}::date
      AND ${orderScopeSql(p)} AND ${currencyFilter(q.basis, Prisma.sql`i.currency_code`)}
    GROUP BY ${g.cols}
    ORDER BY ${q.groupBy === "trend" ? Prisma.sql`1 ASC` : Prisma.sql`amount_all DESC, label`}
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
  const summary = await paymentsCollected(p, from, to, q.basis);
  return {
    period,
    basis: q.basis,
    currency: reportCurrency(q.basis),
    groupBy: q.groupBy,
    trendUnit: q.groupBy === "trend" ? unit : null,
    summary,
    ...paged(
      rows.map((r) => ({ key: r.key, label: r.label, count: int(r.n), amount: money(r.amount), amountAll: money(r.amount_all) })),
      int(rows[0]?.total_rows),
      q.page,
      q.pageSize,
    ),
  };
}

/** Open invoices with aging, as of today (receivables are a point-in-time figure, not period-bound). */
export async function receivablesReport(p: Principal, q: z.output<typeof receivablesQuery>, today = businessDate()) {
  assertPermission(p, "reports.view");
  assertPermission(p, "invoices.view");
  const extra = Prisma.sql`${q.currency ? Prisma.sql`i.currency_code = ${q.currency}` : Prisma.sql`TRUE`} AND ${q.customerId ? Prisma.sql`c.id = ${q.customerId}::uuid` : Prisma.sql`TRUE`}`;
  const amt = amount(q.basis, Prisma.sql`outstanding`, Prisma.sql`all_per_unit`);
  const rows = await getDb().$queryRaw<
    { id: string; invoice_number: string; issue_date: Date; due_date: Date; currency_code: string; total: Prisma.Decimal; outstanding: Prisma.Decimal; amount: Prisma.Decimal; outstanding_all: Prisma.Decimal; order_id: string; order_number: string; customer_id: string; business_name: string; rep: string; total_rows: bigint }[]
  >`${openInvoicesCte(p, q.basis, extra)}
    SELECT r.*, ${amt} AS amount, ROUND(outstanding * all_per_unit, 2) AS outstanding_all,
           e.first_name || ' ' || e.last_name AS rep, COUNT(*) OVER () AS total_rows
    FROM open_invoices r JOIN employees e ON e.id = r.sales_rep_id
    WHERE ${q.overdueOnly ? Prisma.sql`due_date < ${today}::date` : Prisma.sql`TRUE`}
    ORDER BY due_date ASC, invoice_number
    LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
  const summary = await receivablesSummary(p, q.basis, today, q.customerId);
  return {
    asOf: today,
    basis: q.basis,
    currency: reportCurrency(q.basis),
    summary,
    ...paged(
      rows.map((r) => {
        const due = ymd(r.due_date);
        return {
          id: r.id,
          invoiceNumber: r.invoice_number,
          issueDate: ymd(r.issue_date),
          dueDate: due,
          daysOverdue: due < today ? daysInclusive(due, today) - 1 : 0,
          currencyCode: r.currency_code,
          total: money(r.total),
          outstanding: money(r.outstanding),
          outstandingAll: money(r.outstanding_all),
          amount: money(r.amount),
          order: { id: r.order_id, orderNumber: r.order_number },
          customer: { id: r.customer_id, businessName: r.business_name },
          salesRep: r.rep,
        };
      }),
      int(rows[0]?.total_rows),
      q.page,
      q.pageSize,
    ),
  };
}

/* ------------------------------------------------------------ dashboard */

/**
 * Everything the dashboard shows, in ALL (EUR/USD at stored rates). Period-bound
 * figures use the chosen period; receivables, the payment-status split and the
 * recent lists are as of today.
 */
export async function dashboardSummary(p: Principal, q: z.output<typeof dashboardQuery>, today = businessDate()) {
  assertPermission(p, "reports.view");
  const period = periodFor(q, today);
  const { from, to, prevFrom, prevTo } = period;
  const db = getDb();
  const scope = orderScopeSql(p);
  const yearStart = `${to.slice(0, 4)}-01-01`;

  const [sales, prevSales, orders, prevOrders, pipeline, receivables, collected, statusSplit, months, reps, products, customers, activeCustomers, orderedCustomers, recent] =
    await Promise.all([
      invoicedSales(p, from, to, "ALL_EQ"),
      invoicedSales(p, prevFrom, prevTo, "ALL_EQ"),
      ordersByStatus(p, from, to),
      ordersByStatus(p, prevFrom, prevTo),
      orderPipeline(p, from, to, "ALL_EQ"),
      receivablesSummary(p, "ALL_EQ", today),
      paymentsCollected(p, from, to, "ALL_EQ"),
      db.$queryRaw<{ bucket: string; n: bigint; gross: Prisma.Decimal | null }[]>`
        SELECT CASE WHEN i.total - COALESCE(paid.paid, 0) <= 0 THEN 'PAID'
                    WHEN i.due_date < ${today}::date THEN 'OVERDUE'
                    WHEN COALESCE(paid.paid, 0) > 0 THEN 'PARTIALLY_PAID'
                    ELSE 'UNPAID' END AS bucket,
               COUNT(*) AS n, SUM(ROUND(i.total * i.all_per_unit, 2)) AS gross
        FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
        CROSS JOIN LATERAL (SELECT SUM(x.amount) AS paid FROM payments x WHERE x.invoice_id = i.id) paid
        WHERE i.status = 'ISSUED' AND ${scope}
        GROUP BY 1`,
      db.$queryRaw<{ bucket: Date; net: Prisma.Decimal | null }[]>`
        SELECT date_trunc('month', i.issue_date)::date AS bucket, SUM(ROUND(i.taxable_total * i.all_per_unit, 2)) AS net
        ${issuedInvoices(p, yearStart, to, "ALL_EQ")}
        GROUP BY 1`,
      db.$queryRaw<{ id: string; name: string; n: bigint; net: Prisma.Decimal | null }[]>`
        SELECT e.id::text AS id, e.first_name || ' ' || e.last_name AS name, COUNT(*) AS n, SUM(ROUND(i.taxable_total * i.all_per_unit, 2)) AS net
        FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id JOIN employees e ON e.id = o.sales_rep_id
        WHERE i.status = 'ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date AND ${scope}
        GROUP BY e.id, e.first_name, e.last_name ORDER BY net DESC, name LIMIT 8`,
      db.$queryRaw<{ id: string; name: string; quantity: Prisma.Decimal; unit: string; net: Prisma.Decimal | null }[]>`
        SELECT pr.id::text AS id, pr.name, SUM(oi.quantity) AS quantity, MIN(oi.unit) AS unit, SUM(ROUND(oi.taxable_amount * i.all_per_unit, 2)) AS net
        FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
        JOIN order_items oi ON oi.order_id = o.id JOIN products pr ON pr.id = oi.product_id
        WHERE i.status = 'ISSUED' AND i.issue_date BETWEEN ${from}::date AND ${to}::date AND ${scope}
        GROUP BY pr.id, pr.name ORDER BY net DESC, pr.name LIMIT 5`,
      db.$queryRaw<{ id: string; name: string; city: string; net: Prisma.Decimal | null }[]>`
        SELECT c.id::text AS id, c.business_name AS name, c.city, SUM(ROUND(i.taxable_total * i.all_per_unit, 2)) AS net
        ${issuedInvoices(p, from, to, "ALL_EQ")}
        GROUP BY c.id, c.business_name, c.city ORDER BY net DESC, name LIMIT 5`,
      db.customer.count({ where: { AND: [customerScope(p), { status: "ACTIVE" }] } }),
      db.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(DISTINCT o.customer_id) AS n FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.status <> 'CANCELLED' AND ${orderDateIn(from, to)} AND ${scope}`,
      recentActivity(p, today),
    ]);

  const count = (rows: typeof orders, exclude = "CANCELLED") => rows.filter((r) => r.status !== exclude).reduce((s, r) => s + r.count, 0);
  const monthNet = new Map(months.map((m) => [ymd(m.bucket).slice(0, 7), m.net]));
  const lastMonth = Number(to.slice(5, 7));
  const split = new Map(statusSplit.map((s) => [s.bucket, s]));

  return {
    period,
    asOf: today,
    currency: "ALL" as const,
    kpis: {
      invoicedNet: { value: sales.net, previous: prevSales.net, invoices: sales.invoices, gross: sales.gross },
      orders: { value: count(orders), previous: count(prevOrders) },
      pipeline,
      collected,
      activeCustomers: { value: activeCustomers, orderedInPeriod: int(orderedCustomers[0]?.n) },
      receivables,
    },
    ordersByStatus: orders,
    /** Net invoiced per month of the period's final year, January → the period's last month. */
    months: Array.from({ length: lastMonth }, (_, i) => {
      const key = `${to.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`;
      return { month: key, net: money(monthNet.get(key)), partial: i + 1 === lastMonth && to === today && today.slice(8) !== "31" };
    }),
    reps: reps.map((r) => ({ id: r.id, name: r.name, invoices: int(r.n), net: money(r.net) })),
    /** All currently issued invoices, one bucket each (overdue takes precedence over partial/unpaid), gross ALL. */
    paymentStatus: (["PAID", "PARTIALLY_PAID", "UNPAID", "OVERDUE"] as const).map((bucket) => ({
      bucket,
      count: int(split.get(bucket)?.n),
      grossAll: money(split.get(bucket)?.gross),
    })),
    topProducts: products.map((x) => ({ id: x.id, name: x.name, quantity: x.quantity.toString(), unit: x.unit, net: money(x.net) })),
    topCustomers: customers.map((x) => ({ id: x.id, name: x.name, city: x.city, net: money(x.net) })),
    recent,
  };
}

/** The five latest orders, invoices and payments, and the five open invoices due soonest (scope applied). */
async function recentActivity(p: Principal, today: string) {
  const db = getDb();
  const scope = orderScopeSql(p);
  const [orders, invoices, payments, outstanding] = await Promise.all([
    db.$queryRaw<{ id: string; order_number: string; order_date: Date; status: string; currency_code: string; grand_total: Prisma.Decimal; business_name: string; invoiced: boolean }[]>`
      SELECT o.id, o.order_number, o.order_date, o.status::text AS status, o.currency_code, o.grand_total, c.business_name,
             EXISTS (SELECT 1 FROM invoices x WHERE x.order_id = o.id AND x.status = 'ISSUED') AS invoiced
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE ${scope} ORDER BY o.order_date DESC, o.created_at DESC LIMIT 5`,
    db.$queryRaw<{ id: string; invoice_number: string; issue_date: Date; due_date: Date; status: "ISSUED" | "CANCELLED"; currency_code: string; total: Prisma.Decimal; paid: Prisma.Decimal; business_name: string }[]>`
      SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status::text AS status, i.currency_code, i.total, c.business_name,
             COALESCE((SELECT SUM(amount) FROM payments x WHERE x.invoice_id = i.id), 0) AS paid
      FROM invoices i JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
      WHERE ${scope} ORDER BY i.issue_date DESC, i.created_at DESC LIMIT 5`,
    db.$queryRaw<{ id: string; invoice_id: string; invoice_number: string; payment_date: Date; method: string; reference: string | null; amount: Prisma.Decimal; currency_code: string }[]>`
      SELECT pay.id, pay.invoice_id, i.invoice_number, pay.payment_date, pay.method::text AS method, pay.reference, pay.amount, pay.currency_code
      FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN orders o ON o.id = i.order_id JOIN customers c ON c.id = o.customer_id
      WHERE ${scope} ORDER BY pay.payment_date DESC, pay.created_at DESC LIMIT 5`,
    db.$queryRaw<{ id: string; invoice_number: string; due_date: Date; currency_code: string; outstanding: Prisma.Decimal; paid: Prisma.Decimal; business_name: string }[]>`
      ${openInvoicesCte(p, "ALL_EQ")}
      SELECT id, invoice_number, due_date, currency_code, outstanding, total - outstanding AS paid, business_name
      FROM open_invoices ORDER BY due_date ASC, invoice_number LIMIT 5`,
  ]);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      orderDate: ymd(o.order_date),
      status: o.status,
      invoiced: o.invoiced,
      currencyCode: o.currency_code,
      total: money(o.grand_total),
      customer: o.business_name,
    })),
    invoices: invoices.map((i) => {
      const paid = D(i.paid);
      const open = i.status === "ISSUED" && i.total.minus(paid).gt(0);
      return {
        id: i.id,
        invoiceNumber: i.invoice_number,
        issueDate: ymd(i.issue_date),
        currencyCode: i.currency_code,
        total: money(i.total),
        customer: i.business_name,
        paymentStatus: (i.status === "CANCELLED" ? "CANCELLED" : !open ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID") as "CANCELLED" | "PAID" | "PARTIALLY_PAID" | "UNPAID",
        overdue: open && ymd(i.due_date) < today,
      };
    }),
    outstanding: outstanding.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoice_number,
      dueDate: ymd(i.due_date),
      currencyCode: i.currency_code,
      outstanding: money(i.outstanding),
      customer: i.business_name,
      paymentStatus: (D(i.paid).gt(0) ? "PARTIALLY_PAID" : "UNPAID") as "PARTIALLY_PAID" | "UNPAID",
      overdue: ymd(i.due_date) < today,
    })),
    payments: payments.map((x) => ({
      id: x.id,
      invoiceId: x.invoice_id,
      invoiceNumber: x.invoice_number,
      paymentDate: ymd(x.payment_date),
      method: x.method as "CASH" | "BANK_TRANSFER" | "CARD" | "OTHER",
      reference: x.reference,
      amount: money(x.amount),
      currencyCode: x.currency_code,
    })),
  };
}


/* ---------------------------------------------------------- comparisons */

const rangeShape = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, { message: "to is before from.", path: ["to"] })
  .refine((r) => r.from > r.to || daysInclusive(r.from, r.to) <= MAX_CUSTOM_DAYS, { message: "Range longer than 10 years.", path: ["from"] });

export const compareQuery = z.object({ periodA: rangeShape, periodB: rangeShape, basis: z.enum(REPORT_BASES).default("ALL_EQ") });

/**
 * Invoiced sales in two periods and the exact difference, computed here with
 * Decimal (never by the browser or the language model): change = B − A, and
 * percentage = (B − A) / A × 100, rounded half-up to 2 decimals (null when A is 0).
 */
export async function compareInvoicedSales(p: Principal, q: z.output<typeof compareQuery>) {
  assertPermission(p, "reports.view");
  const [a, b] = await Promise.all([invoicedSales(p, q.periodA.from, q.periodA.to, q.basis), invoicedSales(p, q.periodB.from, q.periodB.to, q.basis)]);
  const diff = (x: string, y: string) => D(y).minus(x).toFixed(2);
  const pct = (x: string, y: string) => (D(x).isZero() ? null : D(y).minus(x).div(x).mul(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2));
  return {
    basis: q.basis,
    currency: reportCurrency(q.basis),
    periodA: { ...q.periodA, ...a },
    periodB: { ...q.periodB, ...b },
    change: {
      net: diff(a.net, b.net),
      gross: diff(a.gross, b.gross),
      invoices: b.invoices - a.invoices,
      netPercent: pct(a.net, b.net),
      grossPercent: pct(a.gross, b.gross),
    },
  };
}
