import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { businessDate, utcDate, ymd } from "@/lib/business-date";
import { INVOICE_STATUS_FILTERS, MAX_DUE_DAYS } from "@/lib/invoice-status";
import { CURRENCY_CODES, paymentTermsDays } from "@/lib/labels";
import { INVOICEABLE_STATUSES, type OrderStatusCode } from "@/lib/order-status";
import { assertPermission, hasPermission, isScoped, type Principal } from "@/server/auth/principal";
import { invoiceScope, orderScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { deriveInvoiceStatus } from "@/server/domain/invoice-status";
import { D, isoDate, round2 } from "@/server/domain/money";
import { conflict, invalid, isUniqueViolation, mapDatabaseError, notFound } from "@/server/errors";
import { listQuery, paged } from "@/server/query";
import { withTransactionRetry } from "@/server/retry";
import { rateText } from "./exchange-rates";
import type { Db } from "./order-pricing";
import { lockOrder } from "./orders";

/**
 * Invoices: Route Handler → this service → Prisma → PostgreSQL.
 *
 * - Issued manually from an order that is CONFIRMED, PROCESSING or DELIVERED
 *   (never automatically on confirmation).
 * - The invoice copies the order's financial snapshot: currency, stored rate,
 *   net, discounts, VAT and total. Nothing is recalculated from current product
 *   prices or exchange rates. The guard trigger (guard_invoice) refuses any
 *   insert that does not match the order exactly, and any later change.
 * - One ISSUED invoice per order (partial unique index + guard trigger). A
 *   cancelled invoice stays on record; the order can then only be invoiced again
 *   through a replacement that references it.
 * - Numbers: INV-<issue year>-<000001>, allocated by next_invoice_number() in
 *   the same transaction (gap-free, never reused). Internal identifiers, not
 *   fiscalized invoice numbers.
 * - Payment status is derived, never stored (src/lib/invoice-status.ts).
 */

const ISSUED_INVOICE_LOCK_HINT = "Reload the order: it may have been invoiced or changed by someone else.";

/* ------------------------------------------------------------ schemas */

export const cancelInvoiceSchema = z.strictObject({
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500, "Keep the reason under 500 characters."),
});

/** Issue date is always today's business date; the caller chooses the due date. */
export const issueInvoiceSchema = z.strictObject({
  dueDate: isoDate,
  /** Order version seen by the caller; a stale value means the order changed (409). */
  version: z.string().min(1).optional(),
});
export type IssueInvoiceInput = z.output<typeof issueInvoiceSchema>;

export const replacementSchema = z.strictObject({ dueDate: isoDate });

export const invoiceListQuery = listQuery(["issueDate", "dueDate", "invoiceNumber", "total", "outstanding", "createdAt"] as const, "issueDate", "desc").extend({
  status: z.enum(INVOICE_STATUS_FILTERS).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  customerId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type InvoiceListQuery = z.output<typeof invoiceListQuery>;

/* --------------------------------------------------------------- list */

const NO_EMPLOYEE = "00000000-0000-0000-0000-000000000000";

const SORT_SQL: Record<InvoiceListQuery["sort"], Prisma.Sql> = {
  issueDate: Prisma.sql`issue_date`,
  dueDate: Prisma.sql`due_date`,
  invoiceNumber: Prisma.sql`invoice_number`, // see orderBy below: natural order
  total: Prisma.sql`total`,
  outstanding: Prisma.sql`outstanding`,
  createdAt: Prisma.sql`created_at`,
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

interface ListRow {
  id: string;
  invoice_number: string;
  issue_date: Date;
  due_date: Date;
  status: "ISSUED" | "CANCELLED";
  currency_code: string;
  total: Prisma.Decimal;
  paid: Prisma.Decimal;
  created_at: Date;
  order_id: string;
  order_number: string;
  customer_id: string;
  business_name: string;
  nipt: string;
  replaces_invoice_id: string | null;
}

/**
 * Invoices visible to the caller, with derived payment status. Filtering and
 * sorting by status or outstanding balance need the payment sums, so the list
 * runs as one SQL query. Representative scope is applied in that SQL (their own
 * sales or their customers' orders, as src/server/auth/scope.ts) and checked
 * again with the Prisma scope before anything is returned.
 */
export async function listInvoices(p: Principal, query: InvoiceListQuery = invoiceListQuery.parse({})) {
  assertPermission(p, "invoices.view");
  const db = getDb();
  const today = businessDate();
  const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (isScoped(p)) {
    const emp = p.employeeId ?? NO_EMPLOYEE;
    conds.push(Prisma.sql`(o.sales_rep_id = ${emp}::uuid OR c.assigned_rep_id = ${emp}::uuid)`);
  }
  if (query.currency) conds.push(Prisma.sql`i.currency_code = ${query.currency}`);
  if (query.customerId) conds.push(Prisma.sql`o.customer_id = ${query.customerId}::uuid`);
  if (query.orderId) conds.push(Prisma.sql`i.order_id = ${query.orderId}::uuid`);
  if (query.from) conds.push(Prisma.sql`i.issue_date >= ${query.from}::date`);
  if (query.to) conds.push(Prisma.sql`i.issue_date <= ${query.to}::date`);
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    const nipt = `%${escapeLike(query.q.replace(/\s+/g, ""))}%`;
    conds.push(
      Prisma.sql`(i.invoice_number ILIKE ${like} OR o.order_number ILIKE ${like} OR c.business_name ILIKE ${like} OR c.nipt ILIKE ${nipt})`,
    );
  }
  const statusCond: Record<(typeof INVOICE_STATUS_FILTERS)[number], Prisma.Sql> = {
    OPEN: Prisma.sql`status = 'ISSUED' AND outstanding > 0`,
    UNPAID: Prisma.sql`status = 'ISSUED' AND outstanding > 0 AND paid = 0`,
    PARTIALLY_PAID: Prisma.sql`status = 'ISSUED' AND outstanding > 0 AND paid > 0`,
    PAID: Prisma.sql`status = 'ISSUED' AND outstanding <= 0`,
    OVERDUE: Prisma.sql`status = 'ISSUED' AND outstanding > 0 AND due_date < ${today}::date`,
    CANCELLED: Prisma.sql`status = 'CANCELLED'`,
  };
  const filtered = Prisma.sql`
    WITH base AS (
      SELECT i.id, i.invoice_number, i.issue_date, i.due_date, i.status::text AS status, i.currency_code, i.total, i.created_at,
             i.order_id, o.order_number, o.customer_id, c.business_name, c.nipt, i.replaces_invoice_id,
             COALESCE(pay.paid, 0)::numeric(18,2) AS paid,
             CASE WHEN i.status = 'CANCELLED' THEN 0 ELSE i.total - COALESCE(pay.paid, 0) END AS outstanding
      FROM invoices i
      JOIN orders o ON o.id = i.order_id
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payments GROUP BY invoice_id) pay ON pay.invoice_id = i.id
      WHERE ${Prisma.join(conds, " AND ")}
    ), filtered AS (
      SELECT * FROM base WHERE ${query.status ? statusCond[query.status] : Prisma.sql`TRUE`}
    )`;
  const dir = query.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const sortExpr = SORT_SQL[query.sort];
  // Natural order for INV-<year>-<n> whatever the padding of older numbers (INV-2026-004 < INV-2026-000005).
  const orderBy =
    query.sort === "invoiceNumber"
      ? Prisma.sql`substring(invoice_number from '^INV-(\\d{4})-') ${dir} NULLS LAST, (substring(invoice_number from '^INV-\\d{4}-(\\d+)$'))::bigint ${dir} NULLS LAST, invoice_number ${dir}`
      : Prisma.sql`${sortExpr} ${dir}`;

  const [rows, summary] = await db.$transaction([
    db.$queryRaw<ListRow[]>`${filtered}
      SELECT * FROM filtered ORDER BY ${orderBy}, created_at DESC, id
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    db.$queryRaw<{ currency_code: string; count: bigint; total: Prisma.Decimal | null; outstanding: Prisma.Decimal | null }[]>`${filtered}
      SELECT currency_code, COUNT(*) AS count,
             SUM(total) FILTER (WHERE status = 'ISSUED') AS total,
             SUM(outstanding) FILTER (WHERE status = 'ISSUED') AS outstanding
      FROM filtered GROUP BY currency_code ORDER BY currency_code`,
  ]);

  // Defence in depth: every id must also pass the Prisma scope filter.
  if (isScoped(p) && rows.length) {
    const visible = await db.invoice.count({ where: { AND: [{ id: { in: rows.map((r) => r.id) } }, invoiceScope(p)] } });
    if (visible !== rows.length) throw new Error("Invoice list scope mismatch");
  }

  const total = summary.reduce((s, r) => s + Number(r.count), 0);
  return {
    ...paged(
      rows.map((r) => {
        const b = deriveInvoiceStatus({ status: r.status, total: r.total, dueDate: r.due_date }, D(r.paid), today);
        return {
          id: r.id,
          invoiceNumber: r.invoice_number,
          issueDate: ymd(r.issue_date),
          dueDate: ymd(r.due_date),
          status: r.status,
          currencyCode: r.currency_code,
          total: r.total.toFixed(2),
          paid: b.paid.toFixed(2),
          outstanding: b.outstanding.toFixed(2),
          paymentStatus: b.paymentStatus,
          overdue: b.overdue,
          daysOverdue: b.daysOverdue,
          isReplacement: !!r.replaces_invoice_id,
          order: { id: r.order_id, orderNumber: r.order_number },
          customer: { id: r.customer_id, businessName: r.business_name, nipt: r.nipt },
        };
      }),
      total,
      query.page,
      query.pageSize,
    ),
    /** Per currency, over the whole filtered set (cancelled invoices count but add no money). */
    totals: summary.map((s) => ({
      currencyCode: s.currency_code,
      count: Number(s.count),
      total: D(s.total ?? 0).toFixed(2),
      outstanding: D(s.outstanding ?? 0).toFixed(2),
    })),
    today,
  };
}

/* ------------------------------------------------------------- detail */

const personName = (u: { email: string; employee: { firstName: string; lastName: string } | null } | null) =>
  u ? (u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email) : null;

/** One invoice with its order snapshot, payment history, derived status and allowed actions. */
export async function getInvoice(p: Principal, invoiceId: string) {
  assertPermission(p, "invoices.view");
  const db = getDb();
  const inv = await db.invoice.findFirst({
    where: { AND: [{ id: invoiceId }, invoiceScope(p)] },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          orderDate: true,
          status: true,
          deliverySnapshot: true,
          salesRep: { select: { id: true, firstName: true, lastName: true } },
          customer: {
            select: {
              id: true,
              businessName: true,
              nipt: true,
              city: true,
              businessSize: true,
              addresses: { where: { type: { in: ["BILLING", "BOTH", "REGISTERED_OFFICE"] } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], take: 1 },
            },
          },
          items: { orderBy: [{ productSku: "asc" }, { id: "asc" }] },
          invoices: { select: { status: true } },
        },
      },
      payments: { orderBy: [{ paymentDate: "asc" }, { createdAt: "asc" }] },
      cancelledBy: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } },
      replacesInvoice: { select: { id: true, invoiceNumber: true } },
      replacedBy: { select: { id: true, invoiceNumber: true, status: true } },
    },
  });
  if (!inv) throw notFound("Invoice");
  const today = businessDate();
  const paid = inv.payments.reduce((s, x) => s.plus(x.amount), D(0));
  const b = deriveInvoiceStatus(inv, paid, today);
  const can = (perm: Parameters<typeof hasPermission>[1]) => hasPermission(p, perm);
  const orderHasIssued = inv.order.invoices.some((i) => i.status === "ISSUED");
  const billing = inv.order.customer.addresses[0];
  const foreign = inv.currencyCode !== "ALL";
  let running = D(0);
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    status: inv.status,
    issueDate: ymd(inv.issueDate),
    dueDate: ymd(inv.dueDate),
    currencyCode: inv.currencyCode,
    allPerUnit: inv.allPerUnit.toString(),
    rateText: rateText(inv.allPerUnit),
    totals: {
      subtotalNet: inv.subtotalNet.toFixed(2),
      discountTotal: inv.discountTotal.toFixed(2),
      taxableTotal: inv.taxableTotal.toFixed(2),
      vatTotal: inv.vatTotal.toFixed(2),
      grandTotal: inv.total.toFixed(2),
    },
    /** ALL equivalent at the rate stored on the invoice (information only). */
    totalAll: foreign ? round2(inv.total.mul(inv.allPerUnit)).toFixed(2) : null,
    paid: b.paid.toFixed(2),
    outstanding: b.outstanding.toFixed(2),
    paymentStatus: b.paymentStatus,
    overdue: b.overdue,
    daysOverdue: b.daysOverdue,
    today,
    order: {
      id: inv.order.id,
      orderNumber: inv.order.orderNumber,
      orderDate: ymd(inv.order.orderDate),
      status: inv.order.status,
      salesRep: `${inv.order.salesRep.firstName} ${inv.order.salesRep.lastName}`,
    },
    customer: {
      id: inv.order.customer.id,
      businessName: inv.order.customer.businessName,
      nipt: inv.order.customer.nipt,
      /** The customer's current billing address (addresses are not snapshotted on invoices). */
      billingAddress: billing ? [billing.street, [billing.postalCode, billing.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : inv.order.customer.city,
      paymentTermsDays: paymentTermsDays(inv.order.customer.businessSize),
    },
    /** The order's item snapshot; frozen since the first invoice (guard trigger). */
    items: inv.order.items.map((i) => ({
      id: i.id,
      sku: i.productSku,
      name: i.productName,
      unit: i.unit,
      quantity: i.quantity.toString(),
      unitNetPrice: i.unitNetPrice.toString(),
      discountPercent: i.discountPercent.toString(),
      vatRate: i.vatRate.toString(),
      lineTotal: i.lineTotal.toFixed(2),
    })),
    payments: inv.payments.map((x) => {
      running = running.plus(x.amount);
      return {
        id: x.id,
        paymentDate: ymd(x.paymentDate),
        amount: x.amount.toFixed(2),
        currencyCode: x.currencyCode,
        method: x.method,
        reference: x.reference,
        balanceAfter: inv.total.minus(running).toFixed(2),
        recordedAt: x.createdAt,
      };
    }),
    cancellation:
      inv.status === "CANCELLED"
        ? { at: inv.cancelledAt, reason: inv.cancellationReason, by: personName(inv.cancelledBy) }
        : null,
    replaces: inv.replacesInvoice,
    replacedBy: inv.replacedBy,
    createdAt: inv.createdAt,
    /** What the caller may do now (the server checks again on every request). */
    actions: {
      recordPayment: inv.status === "ISSUED" && b.outstanding.gt(0) && can("payments.record"),
      cancel: inv.status === "ISSUED" && inv.payments.length === 0 && can("invoices.cancel"),
      replace:
        inv.status === "CANCELLED" &&
        !inv.replacedBy &&
        !orderHasIssued &&
        INVOICEABLE_STATUSES.includes(inv.order.status) &&
        can("invoices.issue"),
    },
  };
}

/* ------------------------------------------------------------ issuing */

type OrderSnapshot = {
  id: string;
  currencyCode: string;
  allPerUnit: Prisma.Decimal;
  subtotalNet: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxableTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
};

function checkDueDate(issue: string, due: Date) {
  const d = ymd(due);
  if (d < issue) throw invalid("Due date can't be before the issue date.", { dueDate: [`Choose ${issue} (today) or later.`] });
  const latest = new Date(utcDate(issue).getTime() + MAX_DUE_DAYS * 86_400_000);
  if (due > latest) throw invalid("Due date is too far ahead.", { dueDate: ["Choose a due date within one year of the issue date."] });
}

/**
 * Inserts the invoice inside the caller's transaction, which already holds the
 * order row lock. Copies the order snapshot field for field; the guard trigger
 * verifies the copy, the order status and the one-issued-invoice rule again.
 */
async function insertInvoice(tx: Db, order: OrderSnapshot, dueDate: Date, replacesInvoiceId: string | null) {
  const issue = businessDate();
  checkDueDate(issue, dueDate);
  const [{ number }] = await tx.$queryRaw<{ number: string }[]>`SELECT next_invoice_number(${Number(issue.slice(0, 4))}::int) AS number`;
  return tx.invoice.create({
    data: {
      invoiceNumber: number,
      orderId: order.id,
      replacesInvoiceId,
      currencyCode: order.currencyCode,
      allPerUnit: order.allPerUnit,
      subtotalNet: order.subtotalNet,
      discountTotal: order.discountTotal,
      taxableTotal: order.taxableTotal,
      vatTotal: order.vatTotal,
      total: order.grandTotal,
      issueDate: utcDate(issue),
      dueDate,
    },
    select: { id: true },
  });
}

const ORDER_SNAPSHOT = {
  id: true,
  currencyCode: true,
  allPerUnit: true,
  subtotalNet: true,
  discountTotal: true,
  taxableTotal: true,
  vatTotal: true,
  grandTotal: true,
} as const;

function notInvoiceable(status: OrderStatusCode) {
  return status === "DRAFT"
    ? conflict("ORDER_NOT_INVOICEABLE", "Confirm the order before issuing an invoice.")
    : conflict("ORDER_NOT_INVOICEABLE", `A ${status.toLowerCase()} order can't be invoiced.`);
}

/**
 * Issues the first invoice of an order. Runs in one transaction that locks the
 * order row first, so concurrent requests for the same order are serialized:
 * the first issues, the rest see the invoice and get ORDER_ALREADY_INVOICED.
 */
export async function issueInvoice(p: Principal, orderId: string, input: IssueInvoiceInput) {
  assertPermission(p, "invoices.issue");
  const db = getDb();
  const visible = await db.order.findFirst({ where: { AND: [{ id: orderId }, orderScope(p)] }, select: { id: true } });
  if (!visible) throw notFound("Order");
  try {
    const created = await withTransactionRetry(() =>
      db.$transaction(async (tx) => {
        const row = await lockOrder(tx, orderId, input.version);
        if (!INVOICEABLE_STATUSES.includes(row.status)) throw notInvoiceable(row.status);
        const existing = await tx.invoice.findMany({ where: { orderId }, select: { status: true, invoiceNumber: true }, orderBy: { createdAt: "desc" } });
        const issued = existing.find((i) => i.status === "ISSUED");
        if (issued) throw conflict("ORDER_ALREADY_INVOICED", `This order already has invoice ${issued.invoiceNumber}.`);
        if (existing.length) {
          throw conflict("REPLACEMENT_REQUIRED", `Invoice ${existing[0].invoiceNumber} of this order was cancelled. Issue a replacement from that invoice instead.`);
        }
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: ORDER_SNAPSHOT });
        return insertInvoice(tx, order, input.dueDate, null);
      }),
    );
    return getInvoice(p, created.id);
  } catch (e) {
    if (isUniqueViolation(e, "invoices_one_issued_per_order")) throw conflict("ORDER_ALREADY_INVOICED", `This order already has an issued invoice. ${ISSUED_INVOICE_LOCK_HINT}`);
    throw mapDatabaseError(e);
  }
}

/**
 * Cancels an issued invoice. The cancelled record is kept with its number,
 * reason, time and the user who cancelled it. An invoice with payments cannot be
 * cancelled; the guard trigger enforces this too and, because recording a
 * payment locks the invoice row, a payment and a cancellation racing each other
 * cannot both succeed.
 */
export async function cancelInvoice(p: Principal, invoiceId: string, reason: string) {
  assertPermission(p, "invoices.cancel");
  const db = getDb();
  const invoice = await db.invoice.findFirst({
    where: { AND: [{ id: invoiceId }, invoiceScope(p)] },
    select: { id: true, status: true, _count: { select: { payments: true } } },
  });
  if (!invoice) throw notFound("Invoice");
  if (invoice.status === "CANCELLED") throw conflict("INVOICE_CANCELLED", "Invoice is already cancelled.");
  if (invoice._count.payments) throw conflict("INVOICE_HAS_PAYMENTS", "Cannot cancel invoice with payments");

  try {
    const res = await db.invoice.updateMany({
      where: { id: invoice.id, status: "ISSUED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: reason, cancelledById: p.userId },
    });
    if (res.count !== 1) throw conflict("INVOICE_CANCELLED", "Invoice is already cancelled.");
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return { id: invoice.id, status: "CANCELLED" as const };
}

/**
 * Issues the replacement for a cancelled invoice. Allowed only when:
 * - the invoice is CANCELLED and has not been replaced already,
 * - the order has no ISSUED invoice and is CONFIRMED, PROCESSING or DELIVERED.
 * The replacement copies the same locked snapshot (the order's money, rate and
 * items cannot change once invoiced), gets its own new number and points at the
 * invoice it replaces. Concurrent attempts are serialized by the order lock.
 */
export async function issueReplacementInvoice(p: Principal, cancelledInvoiceId: string, input: { dueDate: Date }) {
  assertPermission(p, "invoices.issue");
  const db = getDb();
  const visible = await db.invoice.findFirst({ where: { AND: [{ id: cancelledInvoiceId }, invoiceScope(p)] }, select: { orderId: true } });
  if (!visible) throw notFound("Invoice");
  try {
    const created = await withTransactionRetry(() =>
      db.$transaction(async (tx) => {
        const row = await lockOrder(tx, visible.orderId, undefined);
        const cancelled = await tx.invoice.findUniqueOrThrow({
          where: { id: cancelledInvoiceId },
          include: { replacedBy: { select: { id: true, invoiceNumber: true } } },
        });
        if (cancelled.status !== "CANCELLED") throw conflict("INVOICE_NOT_CANCELLED", "Only a cancelled invoice can be replaced.");
        if (cancelled.replacedBy) throw conflict("ALREADY_REPLACED", `This invoice has already been replaced by ${cancelled.replacedBy.invoiceNumber}.`);
        if (!INVOICEABLE_STATUSES.includes(row.status)) {
          throw conflict("ORDER_NOT_INVOICEABLE", `Order is ${row.status} and cannot be invoiced.`);
        }
        const issued = await tx.invoice.findFirst({ where: { orderId: visible.orderId, status: "ISSUED" }, select: { invoiceNumber: true } });
        if (issued) throw conflict("ORDER_ALREADY_INVOICED", `This order already has invoice ${issued.invoiceNumber}.`);
        const order = await tx.order.findUniqueOrThrow({ where: { id: visible.orderId }, select: ORDER_SNAPSHOT });
        // The order has been frozen since the first invoice, so this always holds; refuse rather than drift if it ever does not.
        const same =
          order.currencyCode === cancelled.currencyCode &&
          order.allPerUnit.eq(cancelled.allPerUnit) &&
          order.subtotalNet.eq(cancelled.subtotalNet) &&
          order.discountTotal.eq(cancelled.discountTotal) &&
          order.taxableTotal.eq(cancelled.taxableTotal) &&
          order.vatTotal.eq(cancelled.vatTotal) &&
          order.grandTotal.eq(cancelled.total);
        if (!same) throw conflict("SNAPSHOT_MISMATCH", "The order's amounts no longer match the cancelled invoice. Contact an administrator.");
        return insertInvoice(tx, order, input.dueDate, cancelled.id);
      }),
    );
    return getInvoice(p, created.id);
  } catch (e) {
    if (isUniqueViolation(e, "invoices_replaces_invoice_id_key") || isUniqueViolation(e, "invoices_one_issued_per_order")) {
      throw conflict("ALREADY_REPLACED", "This invoice has already been replaced, or the order already has an issued invoice.");
    }
    throw mapDatabaseError(e);
  }
}
