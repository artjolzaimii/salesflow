/**
 * Invoice payment status, derived (never stored) from:
 *   lifecycle status (ISSUED / CANCELLED), total, recorded payments, due date, today.
 *
 * - CANCELLED       the invoice was cancelled (nothing is owed on it)
 * - PAID            payments cover the total
 * - PARTIALLY_PAID  some payments, balance still open
 * - UNPAID          no payments, balance open
 * `overdue` is a separate flag: an open balance past its due date. An overdue
 * invoice with partial payments is therefore both PARTIALLY_PAID and overdue.
 *
 * The server derives these values (src/server/domain/invoice-status.ts) and the
 * list filter in src/server/services/invoices.ts applies the same rules in SQL.
 */
export const INVOICE_PAYMENT_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

/** List filters: the four statuses plus OVERDUE (any open, past-due balance) and OPEN (any balance left). */
export const INVOICE_STATUS_FILTERS = ["OPEN", "UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

/** Badge labels used by the designed screens. */
export const INVOICE_PAYMENT_STATUS_LABEL = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partial",
  PAID: "Paid",
  CANCELLED: "Cancelled",
} as const satisfies Record<InvoicePaymentStatus, string>;

export const INVOICE_STATUS_FILTER_LABEL: Record<InvoiceStatusFilter, string> = {
  OPEN: "Open balance",
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

/**
 * Badges for one invoice: the payment status, with "Overdue" in front when the
 * balance is past due. An unpaid overdue invoice shows only "Overdue"; a
 * partially paid overdue invoice shows "Overdue" and "Partial".
 */
export function invoiceBadges(s: { paymentStatus: InvoicePaymentStatus; overdue: boolean }) {
  const label = INVOICE_PAYMENT_STATUS_LABEL[s.paymentStatus];
  if (!s.overdue) return [label];
  return s.paymentStatus === "UNPAID" ? (["Overdue"] as const) : (["Overdue", label] as const);
}

/** Default due date offset in days when issuing (customer payment terms, else 30). */
export const DEFAULT_DUE_DAYS = 30;
/** Latest allowed due date: one year after issue. */
export const MAX_DUE_DAYS = 366;
