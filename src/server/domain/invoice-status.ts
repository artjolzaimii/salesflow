import type { InvoicePaymentStatus } from "@/lib/invoice-status";
import { ymd } from "@/lib/business-date";
import { D, type Decimal } from "./money";

export interface InvoiceBalance {
  paid: Decimal;
  /** What is still owed: total − paid, or 0 for a cancelled invoice. */
  outstanding: Decimal;
  paymentStatus: InvoicePaymentStatus;
  /** Open balance past the due date (independent of partial payment). */
  overdue: boolean;
  /** Whole days past due while overdue, else 0. */
  daysOverdue: number;
}

/**
 * Derives the payment status of one invoice (see src/lib/invoice-status.ts).
 * `today` is the business date (Europe/Tirane), YYYY-MM-DD.
 */
export function deriveInvoiceStatus(
  invoice: { status: "ISSUED" | "CANCELLED"; total: Decimal; dueDate: Date | string },
  paid: Decimal = D(0),
  today: string,
): InvoiceBalance {
  if (invoice.status === "CANCELLED") return { paid, outstanding: D(0), paymentStatus: "CANCELLED", overdue: false, daysOverdue: 0 };
  const outstanding = invoice.total.minus(paid);
  const open = outstanding.gt(0);
  const due = ymd(invoice.dueDate);
  const overdue = open && due < today;
  return {
    paid,
    outstanding: open ? outstanding : D(0),
    paymentStatus: !open ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID",
    overdue,
    daysOverdue: overdue ? Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86_400_000) : 0,
  };
}
