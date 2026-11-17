import "server-only";
import { z } from "zod";
import { canTransition, ORDER_STATUSES, type OrderStatusCode } from "@/lib/order-status";
import type { Permission } from "@/lib/permissions";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { orderScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { conflict, mapDatabaseError, notFound } from "@/server/errors";

const TRANSITION_PERMISSION: Partial<Record<OrderStatusCode, Permission>> = {
  CONFIRMED: "orders.update",
  PROCESSING: "orders.fulfil",
  DELIVERED: "orders.fulfil",
  CANCELLED: "orders.cancel",
};

export const statusChangeSchema = z.object({ status: z.enum(ORDER_STATUSES) });

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
      customer: { select: { id: true, businessName: true, nipt: true } },
      items: { orderBy: { productSku: "asc" } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, replacesInvoiceId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw notFound("Order");
  const issued = order.invoices.find((i) => i.status === "ISSUED") ?? null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    invoiced: !!issued,
    activeInvoice: issued,
    invoiceHistory: order.invoices,
    customer: order.customer,
    salesRepId: order.salesRepId,
    orderDate: order.orderDate,
    currencyCode: order.currencyCode,
    allPerUnit: order.allPerUnit.toString(),
    totals: {
      subtotalNet: order.subtotalNet.toFixed(2),
      discountTotal: order.discountTotal.toFixed(2),
      taxableTotal: order.taxableTotal.toFixed(2),
      vatTotal: order.vatTotal.toFixed(2),
      grandTotal: order.grandTotal.toFixed(2),
    },
    items: order.items.map((i) => ({
      productId: i.productId,
      sku: i.productSku,
      name: i.productName,
      unit: i.unit,
      quantity: i.quantity.toString(),
      unitNetPrice: i.unitNetPrice.toString(),
      discountPercent: i.discountPercent.toString(),
      vatRate: i.vatRate.toString(),
      lineTotal: i.lineTotal.toFixed(2),
    })),
  };
}

/**
 * Operational status change. Allowed after invoicing (CONFIRMED → PROCESSING →
 * DELIVERED); money, rate and items stay locked by the database trigger. The
 * update is conditional on the status read, so two concurrent changes cannot
 * both apply.
 */
export async function changeOrderStatus(p: Principal, orderId: string, to: OrderStatusCode) {
  const permission = TRANSITION_PERMISSION[to];
  if (!permission) throw conflict("INVALID_STATUS_TRANSITION", `Orders cannot be moved to ${to}.`);
  assertPermission(p, permission);

  const db = getDb();
  const order = await db.order.findFirst({
    where: { AND: [{ id: orderId }, orderScope(p)] },
    select: { id: true, status: true, invoices: { where: { status: "ISSUED" }, select: { id: true } } },
  });
  if (!order) throw notFound("Order");
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
