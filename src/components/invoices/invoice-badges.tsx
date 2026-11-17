"use client";

import { invoiceBadges, type InvoicePaymentStatus } from "@/lib/invoice-status";
import { invalidate } from "@/services/client/query";
import { StatusBadge } from "@/components/ui/status-badge";

/** Derived payment status; an overdue, partially paid invoice shows both "Overdue" and "Partial". */
export function InvoiceStatusBadges({ paymentStatus, overdue }: { paymentStatus: InvoicePaymentStatus; overdue: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {invoiceBadges({ paymentStatus, overdue }).map((label) => (
        <StatusBadge key={label} label={label} />
      ))}
    </span>
  );
}

/** Refetch everything an invoice or payment change can affect. */
export function refreshFinancials(ids: { customerId?: string } = {}) {
  invalidate("/api/invoices");
  invalidate("/api/payments");
  invalidate("/api/orders");
  if (ids.customerId) invalidate(`/api/customers/${ids.customerId}`);
}
