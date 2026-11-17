import "server-only";
import { z } from "zod";
import { INVOICEABLE_STATUSES } from "@/lib/order-status";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { invoiceScope } from "@/server/auth/scope";
import { getDb } from "@/server/db";
import { isoDate } from "@/server/domain/money";
import { conflict, invalid, isUniqueViolation, mapDatabaseError, notFound } from "@/server/errors";

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500),
});

export const replacementSchema = z
  .object({ issueDate: isoDate, dueDate: isoDate })
  .refine((v) => v.dueDate >= v.issueDate, { message: "Due date cannot be before the issue date.", path: ["dueDate"] });

/**
 * Cancels an issued invoice. The cancelled record is kept with its reason, time
 * and the user who cancelled it. An invoice with payments cannot be cancelled
 * (the payments would be orphaned); the database guard enforces this too, and
 * locks the invoice row against a payment being recorded at the same moment.
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
 * - the order has no other ISSUED invoice and is still CONFIRMED, PROCESSING or
 *   DELIVERED (not cancelled).
 * The replacement copies the order's locked financial snapshot (amounts, rate,
 * currency); only dates and the number change. Numbering: <original>-R<n>.
 */
export async function issueReplacementInvoice(p: Principal, cancelledInvoiceId: string, dates: { issueDate: Date; dueDate: Date }) {
  assertPermission(p, "invoices.issue");
  const db = getDb();
  const cancelled = await db.invoice.findFirst({
    where: { AND: [{ id: cancelledInvoiceId }, invoiceScope(p)] },
    include: { replacedBy: { select: { id: true } }, order: true },
  });
  if (!cancelled) throw notFound("Invoice");
  if (cancelled.status !== "CANCELLED") throw conflict("INVOICE_NOT_CANCELLED", "Only a cancelled invoice can be replaced.");
  if (cancelled.replacedBy) throw conflict("ALREADY_REPLACED", "This invoice has already been replaced.");
  const order = cancelled.order;
  if (!INVOICEABLE_STATUSES.includes(order.status)) throw conflict("ORDER_NOT_INVOICEABLE", `Order is ${order.status} and cannot be invoiced.`);
  if (dates.dueDate < dates.issueDate) throw invalid("Due date cannot be before the issue date.");

  const chain = await db.invoice.count({ where: { orderId: order.id } });
  const base = cancelled.invoiceNumber.replace(/-R\d+$/, "");
  try {
    return await db.invoice.create({
      data: {
        invoiceNumber: `${base}-R${chain}`,
        orderId: order.id,
        replacesInvoiceId: cancelled.id,
        currencyCode: order.currencyCode,
        allPerUnit: order.allPerUnit,
        subtotalNet: order.subtotalNet,
        discountTotal: order.discountTotal,
        taxableTotal: order.taxableTotal,
        vatTotal: order.vatTotal,
        total: order.grandTotal,
        issueDate: dates.issueDate,
        dueDate: dates.dueDate,
      },
      select: { id: true, invoiceNumber: true, status: true, total: true, currencyCode: true, replacesInvoiceId: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("ALREADY_REPLACED", "This invoice has already been replaced, or the order already has an issued invoice.");
    throw mapDatabaseError(e);
  }
}
