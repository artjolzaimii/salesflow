import "server-only";
import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/labels";
import { MAX_CUSTOM_DAYS, PERIODS, daysInclusive } from "@/lib/report-period";
import type { Principal } from "@/server/auth/principal";
import { AppError } from "@/server/errors";
import { logError } from "@/server/log";
import { customerListQuery, getCustomer, listCustomers } from "@/server/services/customers";
import { getInvoice, invoiceListQuery, listInvoices } from "@/server/services/invoices";
import { getOrder, listOrders, orderListQuery } from "@/server/services/orders";
import {
  compareInvoicedSales,
  compareQuery,
  collectionsQuery,
  collectionsReport,
  dashboardQuery,
  dashboardSummary,
  receivablesQuery,
  receivablesReport,
  REPORT_BASES,
  salesBreakdown,
  salesReportQuery,
} from "@/server/services/reports";
import type { ToolSpec } from "./types";

/**
 * The only things the assistant can do: read-only tools that call the same
 * services as the screens, with the signed-in user's Principal. Each service
 * checks the permission and applies record scope itself, so a tool can never
 * return more than the user could see on screen. There is no SQL tool and no
 * write tool; the model never sees Prisma.
 */

export interface RecordRef {
  kind: "customer" | "order" | "invoice";
  id: string;
  label: string;
}

export interface ToolOutput {
  data: unknown;
  records: RecordRef[];
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (p: Principal, args: z.output<S>) => Promise<ToolOutput>;
}

const define = <S extends z.ZodType>(t: ToolDef<S>) => t as unknown as ToolDef<z.ZodType>;

/* ------------------------------------------------------------ arguments */

const period = z
  .enum(PERIODS)
  .default("month")
  .describe("today | week (Monday to today) | month (1st to today) | year (1 Jan to today) | custom (needs from and to). Business dates, Europe/Tirane, inclusive.");
const from = z.iso.date().optional().describe("Start date YYYY-MM-DD, only with period=custom.");
const to = z.iso.date().optional().describe("End date YYYY-MM-DD (inclusive), only with period=custom.");
const basis = z
  .enum(REPORT_BASES)
  .default("ALL_EQ")
  .describe("ALL_EQ = every currency converted to ALL at the rate stored on each invoice (default). ALL, EUR or USD = only that currency, original amounts.");
const limit = (max: number, def: number) => z.number().int().min(1).max(max).default(def).describe(`Rows to return (1–${max}).`);

const periodShape = { period, from, to };
function checkPeriod(v: { period: string; from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (v.period !== "custom") {
    if (v.from || v.to) ctx.addIssue({ code: "custom", path: ["period"], message: "from/to are only allowed with period=custom." });
    return;
  }
  if (!v.from || !v.to) return ctx.addIssue({ code: "custom", path: ["from"], message: "period=custom needs both from and to." });
  if (v.from > v.to) ctx.addIssue({ code: "custom", path: ["to"], message: "to is before from." });
  else if (daysInclusive(v.from, v.to) > MAX_CUSTOM_DAYS) ctx.addIssue({ code: "custom", path: ["from"], message: "Range longer than 10 years." });
}
const periodArgs = <T extends z.ZodRawShape>(extra: T) =>
  z.strictObject({ ...periodShape, ...extra }).superRefine((v, ctx) => checkPeriod(v as { period: string; from?: string; to?: string }, ctx));
const periodOf = (a: { period: string; from?: string; to?: string }) => ({ period: a.period, ...(a.period === "custom" ? { from: a.from, to: a.to } : {}) });

const periodOut = (p: { from: string; to: string; label: string }) => ({ from: p.from, to: p.to, label: p.label });
const trunc = (s: string | null | undefined, n: number) => (s == null ? null : s.length > n ? s.slice(0, n) + "…" : s);

/* ------------------------------------------------------------ tools */

const TOOLS = [
  define({
    name: "get_dashboard_summary",
    description:
      "Headline figures for a period: invoiced sales (net and gross, ALL), the previous comparable period, order count and pipeline, payments collected, active customers, orders by status, and receivables (outstanding and overdue as of today).",
    schema: periodArgs({}),
    async run(p, a) {
      const d = await dashboardSummary(p, dashboardQuery.parse(periodOf(a)));
      return {
        data: {
          period: periodOut(d.period),
          comparisonPeriod: { from: d.period.prevFrom, to: d.period.prevTo, label: d.period.prevLabel },
          currency: "ALL (EUR/USD converted at each record's stored rate)",
          invoicedSales: { net: d.kpis.invoicedNet.value, gross: d.kpis.invoicedNet.gross, issuedInvoices: d.kpis.invoicedNet.invoices, previousPeriodNet: d.kpis.invoicedNet.previous },
          orders: { countExcludingCancelled: d.kpis.orders.value, previousPeriod: d.kpis.orders.previous, byStatus: d.ordersByStatus },
          orderPipeline: { confirmedNotInvoiced: d.kpis.pipeline.orders, value: d.kpis.pipeline.value },
          paymentsCollected: { payments: d.kpis.collected.payments, amount: d.kpis.collected.amount },
          activeCustomers: { active: d.kpis.activeCustomers.value, orderedInPeriod: d.kpis.activeCustomers.orderedInPeriod },
          receivablesAsOfToday: {
            asOf: d.kpis.receivables.asOf,
            outstanding: d.kpis.receivables.outstanding,
            openInvoices: d.kpis.receivables.openInvoices,
            overdue: d.kpis.receivables.overdue,
            overdueInvoices: d.kpis.receivables.overdueInvoices,
          },
        },
        records: [],
      };
    },
  }),
  define({
    name: "get_sales_trends",
    description: "Invoiced sales over time (by invoice issue date), bucketed by day for ranges up to 62 days and by month beyond. Use a custom range for 'last six months' or to compare months.",
    schema: periodArgs({ basis }),
    async run(p, a) {
      const r = await salesBreakdown(p, salesReportQuery.parse({ ...periodOf(a), basis: a.basis, groupBy: "trend", pageSize: 100 }));
      return {
        data: {
          period: periodOut(r.period),
          currency: r.currency,
          basis: r.basis,
          bucket: r.trendUnit,
          totals: r.summary.invoiced,
          buckets: r.items.map((x) => ({ start: x.key, invoices: Number(x.count), net: x.net, gross: x.gross })),
          ...(r.pages > 1 ? { note: `Showing the first ${r.items.length} of ${r.total} buckets.` } : {}),
        },
        records: [],
      };
    },
  }),
  ...(["customer", "product", "rep"] as const).map((groupBy) =>
    define({
      name: { customer: "get_top_customers", product: "get_top_products", rep: "get_sales_by_representative" }[groupBy],
      description: {
        customer: "Customers ranked by invoiced net sales in a period (issued invoices by issue date).",
        product: "Products ranked by invoiced net sales in a period, with quantity sold (order lines of issued invoices, converted at each invoice's rate).",
        rep: "Sales representatives ranked by invoiced net sales in a period, credited to the representative recorded on each order.",
      }[groupBy],
      schema: periodArgs({ basis, limit: limit(20, 10) }),
      async run(p, a) {
        const r = await salesBreakdown(p, salesReportQuery.parse({ ...periodOf(a), basis: a.basis, groupBy, pageSize: a.limit }));
        return {
          data: {
            period: periodOut(r.period),
            currency: r.currency,
            basis: r.basis,
            totals: r.summary.invoiced,
            rows: r.items.map((x) => ({
              id: x.key,
              name: x.label,
              ...(groupBy === "customer" ? { city: x.sub, invoices: Number(x.count) } : groupBy === "product" ? { sku: x.sub, quantity: x.count, unit: x.unit } : { invoices: Number(x.count) }),
              net: x.net,
              vat: x.vat,
              gross: x.gross,
            })),
            rowsInTotal: r.total,
          },
          records: groupBy === "customer" ? r.items.map((x) => ({ kind: "customer" as const, id: x.key, label: x.label })) : [],
        };
      },
    }),
  ),
  ...([false, true] as const).map((overdueOnly) =>
    define({
      name: overdueOnly ? "get_overdue_invoices" : "get_outstanding_invoices",
      description: overdueOnly
        ? "Invoices with an open balance past their due date, as of today (not period-bound), oldest due first, with days overdue and aging totals."
        : "Invoices with an open balance as of today (not period-bound), due soonest first, with total outstanding and aging.",
      schema: z.strictObject({ basis, currency: z.enum(CURRENCY_CODES).optional().describe("Only invoices in this currency."), customerId: z.uuid().optional(), limit: limit(50, 20) }),
      async run(p, a) {
        const r = await receivablesReport(p, receivablesQuery.parse({ overdueOnly: String(overdueOnly), basis: a.basis, currency: a.currency, customerId: a.customerId, pageSize: a.limit }));
        return {
          data: {
            asOf: r.asOf,
            currency: r.currency,
            basis: r.basis,
            summary: r.summary,
            invoices: r.items.map((x) => ({
              invoiceNumber: x.invoiceNumber,
              customer: x.customer.businessName,
              salesRep: x.salesRep,
              dueDate: x.dueDate,
              daysOverdue: x.daysOverdue,
              currency: x.currencyCode,
              outstanding: x.outstanding,
              outstandingAll: x.outstandingAll,
            })),
            invoicesInTotal: r.total,
          },
          records: r.items.map((x) => ({ kind: "invoice" as const, id: x.id, label: x.invoiceNumber })),
        };
      },
    }),
  ),
  define({
    name: "compare_invoiced_sales",
    description:
      "Invoiced sales in two date ranges and the exact change between them (amount and percent), computed by SalesFlow. Use this for any comparison of periods instead of subtracting or dividing yourself.",
    schema: z.strictObject({
      periodA: z.strictObject({ from: z.iso.date(), to: z.iso.date() }).describe("Earlier or reference range, inclusive YYYY-MM-DD dates."),
      periodB: z.strictObject({ from: z.iso.date(), to: z.iso.date() }).describe("Range compared against periodA."),
      basis,
    }),
    async run(p, a) {
      const r = await compareInvoicedSales(p, compareQuery.parse(a));
      return { data: { ...r, note: "change = periodB − periodA; percent = change / periodA × 100 (null when periodA is zero)." }, records: [] };
    },
  }),
  define({
    name: "get_payment_collections",
    description: "Payments received in a period (by payment date), converted at each invoice's stored rate, grouped by date bucket, method, currency or customer.",
    schema: periodArgs({ basis, groupBy: z.enum(["trend", "method", "currency", "customer"]).default("trend") }),
    async run(p, a) {
      const r = await collectionsReport(p, collectionsQuery.parse({ ...periodOf(a), basis: a.basis, groupBy: a.groupBy, pageSize: 100 }));
      return {
        data: {
          period: periodOut(r.period),
          currency: r.currency,
          basis: r.basis,
          groupBy: r.groupBy,
          bucket: r.trendUnit,
          totals: r.summary,
          rows: r.items.map((x) => ({ key: x.key, label: x.label, payments: x.count, amount: x.amount, amountAll: x.amountAll })),
        },
        records: [],
      };
    },
  }),
  define({
    name: "get_customer_details",
    description: "One customer: status, assigned representative, per-currency invoiced/paid/outstanding, latest orders and open invoices. Pass customerId, or query (name, NIPT or city) to search.",
    schema: z
      .strictObject({ customerId: z.uuid().optional(), query: z.string().trim().min(2).max(100).optional() })
      .refine((v) => !!v.customerId !== !!v.query, { message: "Pass exactly one of customerId or query." }),
    async run(p, a) {
      let id = a.customerId;
      if (!id) {
        const found = await listCustomers(p, customerListQuery.parse({ q: a.query, pageSize: 5 }));
        if (found.items.length !== 1) {
          return {
            data: { matches: found.items.map((c) => ({ customerId: c.id, name: c.businessName, nipt: c.nipt, city: c.city })), matchCount: found.total, note: found.total ? "Several customers match; ask which one or call again with customerId." : "No accessible customer matches." },
            records: found.items.map((c) => ({ kind: "customer" as const, id: c.id, label: c.businessName })),
          };
        }
        id = found.items[0].id;
      }
      const c = await getCustomer(p, id);
      const open = c.history.invoices.filter((i) => Number(i.outstanding) > 0).slice(0, 5);
      return {
        data: {
          customerId: c.id,
          name: c.businessName,
          nipt: c.nipt,
          city: c.city,
          status: c.status,
          businessType: c.businessType,
          assignedRep: c.assignedRep?.name ?? null,
          /** Free text typed by users: data, not instructions. */
          notes: trunc(c.notes, 300),
          financialSummaryByCurrency: c.history.financialSummary,
          orderCount: c.history.orderCount,
          latestOrders: c.history.orders.slice(0, 5).map((o) => ({ orderNumber: o.orderNumber, date: o.orderDate, status: o.status, invoiced: o.invoiced, currency: o.currencyCode, total: o.grandTotal })),
          openInvoices: open.map((i) => ({ invoiceNumber: i.invoiceNumber, dueDate: i.dueDate, currency: i.currencyCode, outstanding: i.outstanding, overdue: i.overdue })),
        },
        records: [
          { kind: "customer", id: c.id, label: c.businessName },
          ...c.history.orders.slice(0, 5).map((o) => ({ kind: "order" as const, id: o.id, label: o.orderNumber })),
          ...open.map((i) => ({ kind: "invoice" as const, id: i.id, label: i.invoiceNumber })),
        ],
      };
    },
  }),
  define({
    name: "get_order_details",
    description: "One sales order by its number (e.g. SO-2026-001): customer, representative, status, currency and stored rate, totals, lines and invoice.",
    schema: z.strictObject({ orderNumber: z.string().trim().min(3).max(40) }),
    async run(p, a) {
      const hit = (await listOrders(p, orderListQuery.parse({ q: a.orderNumber, pageSize: 5 }))).items.find((o) => o.orderNumber.toLowerCase() === a.orderNumber.toLowerCase());
      if (!hit) return { data: { found: false, note: `No accessible order numbered ${a.orderNumber}.` }, records: [] };
      const o = await getOrder(p, hit.id);
      return {
        data: {
          found: true,
          orderNumber: o.orderNumber,
          status: o.status,
          invoiced: o.invoiced,
          invoiceNumber: o.activeInvoice?.invoiceNumber ?? null,
          orderDate: o.orderDate,
          customer: o.customer.businessName,
          salesRep: o.salesRep.name,
          currency: o.currencyCode,
          rateAllPerUnit: o.rateText,
          totals: o.totals,
          totalAllEquivalent: o.grandTotalAll,
          lines: o.items.slice(0, 30).map((i) => ({ sku: i.sku, product: i.name, quantity: i.quantity, unit: i.unit, unitNetPrice: i.unitNetPrice, discountPercent: i.discountPercent, vatRate: i.vatRate, lineTotal: i.lineTotal })),
        },
        records: [
          { kind: "order", id: o.id, label: o.orderNumber },
          { kind: "customer", id: o.customer.id, label: o.customer.businessName },
          ...(o.activeInvoice ? [{ kind: "invoice" as const, id: o.activeInvoice.id, label: o.activeInvoice.invoiceNumber }] : []),
        ],
      };
    },
  }),
  define({
    name: "get_invoice_details",
    description: "One invoice by its number (e.g. INV-2026-000005): status, payment status, overdue, totals, stored rate, paid and outstanding, payment history and the order it belongs to.",
    schema: z.strictObject({ invoiceNumber: z.string().trim().min(3).max(50) }),
    async run(p, a) {
      const hit = (await listInvoices(p, invoiceListQuery.parse({ q: a.invoiceNumber, pageSize: 5 }))).items.find((i) => i.invoiceNumber.toLowerCase() === a.invoiceNumber.toLowerCase());
      if (!hit) return { data: { found: false, note: `No accessible invoice numbered ${a.invoiceNumber}.` }, records: [] };
      const i = await getInvoice(p, hit.id);
      return {
        data: {
          found: true,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          paymentStatus: i.paymentStatus,
          overdue: i.overdue,
          daysOverdue: i.daysOverdue,
          issueDate: i.issueDate,
          dueDate: i.dueDate,
          customer: i.customer.billedName,
          orderNumber: i.order.orderNumber,
          currency: i.currencyCode,
          rateAllPerUnit: i.rateText,
          totals: i.totals,
          totalAllEquivalent: i.totalAll,
          paid: i.paid,
          outstanding: i.outstanding,
          payments: i.payments.slice(0, 20).map((x) => ({ date: x.paymentDate, method: x.method, amount: x.amount, reference: trunc(x.reference, 60) })),
          replaces: i.replaces?.invoiceNumber ?? null,
          replacedBy: i.replacedBy?.invoiceNumber ?? null,
          cancellationReason: trunc(i.cancellation?.reason, 200),
        },
        records: [
          { kind: "invoice", id: i.id, label: i.invoiceNumber },
          { kind: "order", id: i.order.id, label: i.order.orderNumber },
          { kind: "customer", id: i.customer.id, label: i.customer.billedName },
        ],
      };
    },
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const TOOL_NAMES = TOOLS.map((t) => t.name);

/** Tool definitions sent to the model (JSON Schema generated from the Zod schemas). */
export function toolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown> }));
}

export interface ToolRun {
  name: string;
  ok: boolean;
  /** Serialized result for the model (≤ maxChars). */
  content: string;
  records: RecordRef[];
  truncated: boolean;
  error?: string;
}

/**
 * Validates and runs one tool call. Unknown tools, invalid arguments, denied
 * access and failures become error results the model can read; nothing throws
 * out of here, and internal error details are never included.
 */
export async function runTool(p: Principal, name: string, input: unknown, opts: { maxChars: number; timeoutMs: number }): Promise<ToolRun> {
  const tool = BY_NAME.get(name);
  if (!tool) return failure(name, "UNKNOWN_TOOL", `There is no tool named "${name}". Available: ${TOOL_NAMES.join(", ")}.`);
  const args = tool.schema.safeParse(input ?? {});
  if (!args.success) {
    return failure(name, "INVALID_ARGUMENTS", "Invalid arguments: " + args.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      tool.run(p, args.data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError(504, "TOOL_TIMEOUT", "The lookup took too long.")), opts.timeoutMs);
      }),
    ]);
    const { text, truncated } = serialize(out.data, opts.maxChars);
    return { name, ok: true, content: text, records: out.records, truncated };
  } catch (e) {
    if (e instanceof AppError) {
      // 403/404 keep their meaning without disclosing anything beyond "not accessible".
      const msg = e.status === 403 ? "You don't have permission for this data." : e.status === 404 ? "No accessible record matches." : e.message;
      return failure(name, e.code, msg);
    }
    if (e instanceof z.ZodError) return failure(name, "INVALID_ARGUMENTS", "Invalid arguments: " + e.issues.map((i) => i.message).join("; "));
    logError("assistant", e, { tool: name });
    return failure(name, "TOOL_FAILED", "The lookup failed. Try again or rephrase.");
  } finally {
    clearTimeout(timer);
  }
}

function failure(name: string, code: string, message: string): ToolRun {
  return { name, ok: false, content: JSON.stringify({ error: code, message }), records: [], truncated: false, error: code };
}

/**
 * JSON for the model, within maxChars: the longest array is halved until it fits
 * (and the result says so); never a cut mid-value.
 */
export function serialize(data: unknown, maxChars: number): { text: string; truncated: boolean } {
  let text = JSON.stringify(data);
  if (text.length <= maxChars) return { text, truncated: false };
  const copy = JSON.parse(text) as unknown;
  const arrays: unknown[][] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      arrays.push(v);
      v.forEach(walk);
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(copy);
  while (text.length > maxChars) {
    const longest = arrays.reduce<unknown[] | null>((m, a) => (a.length > 1 && (!m || a.length > m.length) ? a : m), null);
    if (!longest) break;
    longest.length = Math.ceil(longest.length / 2);
    text = JSON.stringify({ truncated: "Some lists were shortened to fit; say so if it matters.", data: copy });
  }
  if (text.length > maxChars) text = JSON.stringify({ truncated: "Result too large to return.", error: "RESULT_TOO_LARGE" });
  return { text, truncated: true };
}
