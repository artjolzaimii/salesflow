import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { ymd } from "@/lib/business-date";
import { CURRENCY_CODES } from "@/lib/labels";
import { canTransition, ORDER_STATUSES, type OrderStatusCode } from "@/lib/order-status";
import type { Permission } from "@/lib/permissions";
import { orderCreateSchema, orderQuoteSchema, orderUpdateSchema } from "@/lib/schemas/orders";
import { assertPermission, hasPermission, type Principal } from "@/server/auth/principal";
import { orderScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { D, round2 } from "@/server/domain/money";
import { unitPriceInCurrency } from "@/server/domain/pricing";
import { conflict, invalid, isUniqueViolation, mapDatabaseError, notFound } from "@/server/errors";
import { listQuery, paged, skipTake } from "@/server/query";
import { withTransactionRetry } from "@/server/retry";
import { rateText } from "./exchange-rates";
import { applicableRate, noRateError, priceLines, priceOrder, totalsDto, type Db, type ExistingOrder, type PricedOrder } from "./order-pricing";

/**
 * Sales orders: Route Handler → this service → order-pricing → Prisma.
 *
 * Lifecycle (src/lib/order-status.ts, enforced again by the database trigger):
 *   DRAFT → CONFIRMED → PROCESSING → DELIVERED, and → CANCELLED from the first three.
 * Editing is possible while the order is DRAFT or CONFIRMED and has never had
 * an invoice. Any invoice (issued or cancelled) locks money, rate and items;
 * the database trigger enforces that lock as well.
 */

const TRANSITION_PERMISSION: Partial<Record<OrderStatusCode, Permission>> = {
  CONFIRMED: "orders.update",
  PROCESSING: "orders.fulfil",
  DELIVERED: "orders.fulfil",
  CANCELLED: "orders.cancel",
};

const EDITABLE: readonly OrderStatusCode[] = ["DRAFT", "CONFIRMED"];

export const statusChangeSchema = z.object({ status: z.enum(ORDER_STATUSES), version: z.string().min(1).optional() });

const repName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;
const version = (d: Date) => d.toISOString();

/* ---------------------------------------------------------------- list */

export const orderListQuery = listQuery(["orderDate", "orderNumber", "grandTotal", "status", "createdAt"] as const, "orderDate", "desc").extend({
  status: z.enum([...ORDER_STATUSES, "INVOICED"]).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  customerId: z.uuid().optional(),
  repId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type OrderListQuery = z.output<typeof orderListQuery>;

/** Orders visible to the caller (representatives: their own sales and their customers' orders). */
export async function listOrders(p: Principal, query: OrderListQuery = orderListQuery.parse({})) {
  assertPermission(p, "orders.view");
  const where: Prisma.OrderWhereInput = {
    AND: [
      orderScope(p),
      query.status === "INVOICED" ? { invoices: { some: { status: "ISSUED" } } } : query.status ? { status: query.status } : {},
      query.currency ? { currencyCode: query.currency } : {},
      query.customerId ? { customerId: query.customerId } : {},
      query.repId ? { salesRepId: query.repId } : {},
      query.from ? { orderDate: { gte: new Date(query.from + "T00:00:00Z") } } : {},
      query.to ? { orderDate: { lt: new Date(new Date(query.to + "T00:00:00Z").getTime() + 86_400_000) } } : {},
      query.q
        ? {
            OR: [
              { orderNumber: { contains: query.q, mode: "insensitive" } },
              { customer: { businessName: { contains: query.q, mode: "insensitive" } } },
              { customer: { nipt: { contains: query.q.replace(/\s+/g, ""), mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const db = getDb();
  const [rows, total] = await db.$transaction([
    db.order.findMany({
      where,
      orderBy: [{ [query.sort]: query.dir }, { createdAt: "desc" }],
      ...skipTake(query.page, query.pageSize),
      select: {
        id: true,
        orderNumber: true,
        orderDate: true,
        status: true,
        currencyCode: true,
        allPerUnit: true,
        grandTotal: true,
        customer: { select: { id: true, businessName: true, nipt: true } },
        salesRep: { select: { id: true, firstName: true, lastName: true } },
        invoices: { where: { status: "ISSUED" }, select: { invoiceNumber: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
  ]);
  return paged(
    rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      orderDate: ymd(o.orderDate),
      status: o.status,
      invoiced: o.invoices.length > 0,
      invoiceNumber: o.invoices[0]?.invoiceNumber ?? null,
      currencyCode: o.currencyCode,
      allPerUnit: rateText(o.allPerUnit),
      grandTotal: o.grandTotal.toFixed(2),
      customer: o.customer,
      salesRep: { id: o.salesRep.id, name: repName(o.salesRep) },
      itemCount: o._count.items,
    })),
    total,
    query.page,
    query.pageSize,
  );
}

/* -------------------------------------------------------------- detail */

/**
 * Order detail for the caller. Items come from the order-item snapshot
 * (name, SKU, unit, price, VAT as sold), never from the current product row.
 * `invoiced` is derived from an ISSUED invoice; it is not an order status.
 */
export async function getOrder(p: Principal, orderId: string) {
  assertPermission(p, "orders.view");
  const order = await getDb().order.findFirst({
    where: { AND: [{ id: orderId }, orderScope(p)] },
    include: {
      customer: { select: { id: true, businessName: true, nipt: true, status: true, city: true } },
      salesRep: { select: { id: true, firstName: true, lastName: true } },
      items: { orderBy: [{ productSku: "asc" }, { id: "asc" }], include: { product: { select: { defaultNetAll: true, isActive: true, vatRate: true } } } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, replacesInvoiceId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw notFound("Order");
  const issued = order.invoices.find((i) => i.status === "ISSUED") ?? null;
  const locked = order.invoices.length > 0;
  const editable = EDITABLE.includes(order.status) && !locked;
  const can = (perm: Permission) => hasPermission(p, perm);
  const foreign = order.currencyCode !== "ALL";
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    invoiced: !!issued,
    activeInvoice: issued,
    invoiceHistory: order.invoices,
    /** Any invoice, issued or cancelled, freezes money, rate and items. */
    financiallyLocked: locked,
    editable,
    /** Pass back on edit/confirm: a stale value means someone else changed the order (409). */
    version: version(order.updatedAt),
    customer: order.customer,
    salesRepId: order.salesRepId,
    salesRep: { id: order.salesRep.id, name: repName(order.salesRep) },
    orderDate: ymd(order.orderDate),
    deliveryAddressId: order.deliveryAddressId,
    delivery: order.deliverySnapshot as Record<string, string | boolean | null> | null,
    currencyCode: order.currencyCode,
    allPerUnit: order.allPerUnit.toString(),
    rateText: rateText(order.allPerUnit),
    totals: {
      subtotalNet: order.subtotalNet.toFixed(2),
      discountTotal: order.discountTotal.toFixed(2),
      taxableTotal: order.taxableTotal.toFixed(2),
      vatTotal: order.vatTotal.toFixed(2),
      grandTotal: order.grandTotal.toFixed(2),
    },
    /** ALL equivalent of the total at the order's stored rate (information only). */
    grandTotalAll: foreign ? round2(order.grandTotal.mul(order.allPerUnit)).toFixed(2) : null,
    items: order.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      sku: i.productSku,
      name: i.productName,
      unit: i.unit,
      quantity: i.quantity.toString(),
      unitNetPrice: i.unitNetPrice.toString(),
      discountPercent: i.discountPercent.toString(),
      vatRate: i.vatRate.toString(),
      grossNet: i.grossNet.toFixed(2),
      discountAmount: i.discountAmount.toFixed(2),
      taxableAmount: i.taxableAmount.toFixed(2),
      vatAmount: i.vatAmount.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
      // Comparison with today's catalogue only matters while the order can still change.
      priceOverride: editable ? !i.unitNetPrice.eq(unitPriceInCurrency(i.product.defaultNetAll, order.allPerUnit)) : null,
      productActive: editable ? i.product.isActive : null,
      /** Today's catalogue values (editable orders only): what an edit would re-price with. */
      catalogueNetAll: editable ? i.product.defaultNetAll.toString() : null,
      catalogueVatRate: editable ? i.product.vatRate.toString() : null,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    /** What the caller may do now (the server checks again on every request). */
    actions: {
      edit: editable && can("orders.update"),
      confirm: order.status === "DRAFT" && can("orders.update"),
      markProcessing: order.status === "CONFIRMED" && can("orders.fulfil"),
      markDelivered: order.status === "PROCESSING" && can("orders.fulfil"),
      cancel: ["DRAFT", "CONFIRMED", "PROCESSING"].includes(order.status) && !issued && can("orders.cancel"),
      overridePrices: can("prices.override"),
    },
  };
}

/* --------------------------------------------------------------- quote */

function pricedDto(priced: PricedOrder) {
  const foreign = priced.rate.currencyCode !== "ALL";
  return {
    currencyCode: priced.rate.currencyCode,
    rate: {
      allPerUnit: rateText(priced.rate.allPerUnit),
      effectiveAt: priced.rate.effectiveAt,
    },
    salesRepId: priced.salesRepId,
    lines: priced.lines.map((l) => ({
      productId: l.productId,
      sku: l.productSku,
      name: l.productName,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitNetPrice: l.unitNetPrice.toFixed(4),
      catalogueUnitPrice: l.catalogueUnitPrice.toFixed(4),
      priceOverride: l.priceOverride,
      discountPercent: l.discountPercent.toString(),
      vatRate: l.vatRate.toString(),
      grossNet: l.grossNet.toFixed(2),
      discountAmount: l.discountAmount.toFixed(2),
      taxableAmount: l.taxableAmount.toFixed(2),
      vatAmount: l.vatAmount.toFixed(2),
      lineTotal: l.lineTotal.toFixed(2),
    })),
    totals: totalsDto(priced.totals),
    grandTotalAll: foreign ? round2(priced.totals.grandTotal.mul(priced.rate.allPerUnit)).toFixed(2) : null,
  };
}

async function existingFor(db: Db, p: Principal, orderId: string): Promise<ExistingOrder & { id: string; status: OrderStatusCode; updatedAt: Date; invoiceCount: number }> {
  const o = await db.order.findFirst({
    where: { AND: [{ id: orderId }, orderScope(p)] },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      customerId: true,
      salesRepId: true,
      currencyCode: true,
      allPerUnit: true,
      items: { select: { id: true, productId: true, unitNetPrice: true } },
      _count: { select: { invoices: true } },
    },
  });
  if (!o) throw notFound("Order");
  return { ...o, invoiceCount: o._count.invoices };
}

/** Prices an order without saving it: the server-confirmed figures the form shows next to its estimate. */
export async function quoteOrder(p: Principal, raw: unknown) {
  const input = orderQuoteSchema.parse(raw);
  assertPermission(p, input.orderId ? "orders.update" : "orders.create");
  const db = getDb();
  const existing = input.orderId ? await existingFor(db, p, input.orderId) : undefined;
  return pricedDto(await priceOrder(db, p, input, existing));
}

/* -------------------------------------------------------------- create */

const ORDER_NUMBER_LOCK = 0x5f0001; // pg_advisory_xact_lock key for order numbering

/**
 * Next order number for the year: SO-YYYY-NNN, continuing the highest existing
 * number. Runs under a transaction-scoped advisory lock, so concurrent creates
 * are numbered one after another instead of colliding.
 */
async function nextOrderNumber(tx: Db, year: number): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ORDER_NUMBER_LOCK}::bigint)`;
  const prefix = `SO-${year}-`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX((substring(order_number FROM '^SO-[0-9]{4}-([0-9]+)$'))::int) AS max
    FROM orders WHERE order_number LIKE ${prefix + "%"}`;
  const next = (rows[0]?.max ?? 0) + 1;
  return prefix + String(next).padStart(3, "0");
}

function itemRows(priced: PricedOrder) {
  return priced.lines.map((l) => ({
    productId: l.productId,
    productSku: l.productSku,
    productName: l.productName,
    unit: l.unit,
    quantity: l.quantity,
    unitNetPrice: l.unitNetPrice,
    discountPercent: l.discountPercent,
    vatRate: l.vatRate,
    grossNet: l.grossNet,
    discountAmount: l.discountAmount,
    taxableAmount: l.taxableAmount,
    vatAmount: l.vatAmount,
    lineTotal: l.lineTotal,
  }));
}

/** Creates an order as DRAFT or CONFIRMED, priced entirely on the server. */
export async function createOrder(p: Principal, raw: unknown) {
  assertPermission(p, "orders.create");
  const input = orderCreateSchema.parse(raw);
  if (input.status === "CONFIRMED") assertPermission(p, "orders.update");
  const id = await withTransactionRetry(() =>
    getDb().$transaction(async (tx) => {
      const priced = await priceOrder(tx, p, input);
      const orderNumber = await nextOrderNumber(tx, priced.orderDate.getUTCFullYear());
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerId: priced.customer.id,
          salesRepId: priced.salesRepId,
          deliveryAddressId: priced.deliveryAddressId,
          deliverySnapshot: priced.deliverySnapshot,
          currencyCode: priced.rate.currencyCode,
          allPerUnit: priced.rate.allPerUnit,
          status: input.status,
          orderDate: priced.orderDate,
          ...priced.totals,
          items: { create: itemRows(priced) },
        },
        select: { id: true },
      });
      return order.id;
    }),
  ).catch((e) => {
    if (isUniqueViolation(e, "orders_order_number_key")) throw conflict("CONCURRENT_UPDATE", "Another order took this number. Please save again.");
    throw mapDatabaseError(e);
  });
  return getOrder(p, id);
}

/* ---------------------------------------------------------------- edit */

/**
 * Locks the order row for this transaction and checks it is still the version
 * the caller loaded. Every writer (edit, confirm, status change) locks the row
 * first, so concurrent writers run one after another and the later one sees
 * the new version and gets a 409 instead of overwriting.
 */
async function lockOrder(tx: Db, id: string, expectedVersion: string | undefined) {
  const rows = await tx.$queryRaw<{ status: OrderStatusCode; updated_at: Date }[]>`
    SELECT status, updated_at FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw notFound("Order");
  if (expectedVersion && version(row.updated_at) !== expectedVersion) {
    throw conflict("CONCURRENT_UPDATE", "Someone else changed this order after you opened it. Reload it to see the latest version.");
  }
  return row;
}

/**
 * Replaces the order body (customer, rep, date, delivery, currency, lines) and
 * re-prices everything. Allowed for DRAFT and CONFIRMED orders that have never
 * been invoiced.
 */
export async function updateOrder(p: Principal, orderId: string, raw: unknown) {
  assertPermission(p, "orders.update");
  const input = orderUpdateSchema.parse(raw);
  await getDb()
    .$transaction(async (tx) => {
      await existingFor(tx, p, orderId); // scope first: out-of-scope is a 404, never a version conflict
      const row = await lockOrder(tx, orderId, input.version);
      const existing = await existingFor(tx, p, orderId); // re-read under the lock
      if (existing.invoiceCount > 0 || (await tx.invoice.count({ where: { orderId } })) > 0) {
        throw conflict("ORDER_FINANCIALLY_LOCKED", "This order has been invoiced; its amounts, rate and items can no longer change.");
      }
      if (!EDITABLE.includes(row.status)) {
        throw conflict("ORDER_NOT_EDITABLE", `A ${row.status.toLowerCase()} order can't be edited. Only draft and confirmed orders can.`);
      }
      const priced = await priceOrder(tx, p, input, existing);
      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.update({
        where: { id: orderId },
        data: {
          customerId: priced.customer.id,
          salesRepId: priced.salesRepId,
          deliveryAddressId: priced.deliveryAddressId,
          deliverySnapshot: priced.deliverySnapshot,
          currencyCode: priced.rate.currencyCode,
          allPerUnit: priced.rate.allPerUnit,
          orderDate: priced.orderDate,
          ...priced.totals,
          items: { create: itemRows(priced) },
        },
      });
    })
    .catch((e) => {
      throw mapDatabaseError(e);
    });
  return getOrder(p, orderId);
}

/* ------------------------------------------------------------- confirm */

/**
 * DRAFT → CONFIRMED. Re-checks everything that can have changed since the
 * draft was saved and recomputes the totals from the stored lines with the
 * shared pricing rules, inside one locked transaction:
 * - the customer is still active,
 * - the order has at least one line,
 * - for EUR/USD, a rate is in effect on the order date and is still the rate
 *   the draft was priced with (a back-dated correction must be reviewed first).
 */
export async function confirmOrder(p: Principal, orderId: string, expectedVersion?: string) {
  assertPermission(p, "orders.update");
  const db = getDb();
  const visible = await db.order.findFirst({ where: { AND: [{ id: orderId }, orderScope(p)] }, select: { id: true } });
  if (!visible) throw notFound("Order");
  await db
    .$transaction(async (tx) => {
      const row = await lockOrder(tx, orderId, expectedVersion);
      if (row.status !== "DRAFT") throw conflict("INVALID_STATUS_TRANSITION", `Invalid order status transition: ${row.status} -> CONFIRMED`);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, customer: { select: { businessName: true, status: true } } },
      });
      if (order.customer.status !== "ACTIVE") {
        throw conflict("CUSTOMER_NOT_ACTIVE", `${order.customer.businessName} is ${order.customer.status.toLowerCase()}; the order can't be confirmed.`);
      }
      if (!order.items.length) throw invalid("Add at least one product line before confirming.", { lines: ["Add at least one product line."] });
      const rate = await applicableRate(tx, order.currencyCode, order.orderDate);
      if (!rate) throw noRateError(order.currencyCode, order.orderDate);
      if (!rate.allPerUnit.eq(order.allPerUnit)) {
        throw conflict(
          "EXCHANGE_RATE_CHANGED",
          `The ${order.currencyCode} rate for this order date is now ${rateText(rate.allPerUnit)} ALL, but the draft was priced at ${rateText(order.allPerUnit)} ALL. Open the order and save it again to re-price it before confirming.`,
        );
      }
      const { lines, totals } = priceLines(order.items);
      for (const l of lines) {
        const changed = (["grossNet", "discountAmount", "taxableAmount", "vatAmount", "lineTotal"] as const).some((k) => !D(order.items.find((i) => i.id === l.id)![k]).eq(l[k]));
        if (changed) {
          await tx.orderItem.update({
            where: { id: l.id },
            data: { grossNet: l.grossNet, discountAmount: l.discountAmount, taxableAmount: l.taxableAmount, vatAmount: l.vatAmount, lineTotal: l.lineTotal },
          });
        }
      }
      await tx.order.update({ where: { id: orderId }, data: { status: "CONFIRMED", ...totals } });
    })
    .catch((e) => {
      throw mapDatabaseError(e);
    });
  return getOrder(p, orderId);
}

/* -------------------------------------------------------------- status */

/**
 * Operational status change. Allowed after invoicing (CONFIRMED → PROCESSING →
 * DELIVERED); money, rate and items stay locked by the database trigger and are
 * not touched here. Confirmation goes through confirmOrder (re-pricing checks).
 * The update is conditional on the status read, so two concurrent changes
 * cannot both apply.
 */
export async function changeOrderStatus(p: Principal, orderId: string, to: OrderStatusCode, expectedVersion?: string) {
  const permission = TRANSITION_PERMISSION[to];
  if (!permission) throw conflict("INVALID_STATUS_TRANSITION", `Orders cannot be moved to ${to}.`);
  assertPermission(p, permission);
  if (to === "CONFIRMED") {
    const o = await confirmOrder(p, orderId, expectedVersion);
    return { id: o.id, from: "DRAFT" as OrderStatusCode, status: o.status };
  }

  const db = getDb();
  const order = await db.order.findFirst({
    where: { AND: [{ id: orderId }, orderScope(p)] },
    select: { id: true, status: true, updatedAt: true, invoices: { where: { status: "ISSUED" }, select: { id: true } } },
  });
  if (!order) throw notFound("Order");
  if (expectedVersion && version(order.updatedAt) !== expectedVersion) {
    throw conflict("CONCURRENT_UPDATE", "Someone else changed this order after you opened it. Reload it to see the latest version.");
  }
  if (!canTransition(order.status, to)) {
    throw conflict("INVALID_STATUS_TRANSITION", `Invalid order status transition: ${order.status} -> ${to}`);
  }
  if (to === "CANCELLED" && order.invoices.length) {
    throw conflict("ORDER_HAS_ISSUED_INVOICE", "Cannot cancel an order with an issued invoice");
  }

  try {
    const res = await db.order.updateMany({ where: { id: order.id, status: order.status }, data: { status: to } });
    if (res.count !== 1) throw conflict("CONCURRENT_UPDATE", "The order changed while you were editing it. Reload and try again.");
  } catch (e) {
    throw mapDatabaseError(e);
  }
  return { id: order.id, from: order.status, status: to };
}
