import type { Cents, Currency, ISODate, Invoice, OrderItem, PaymentStatus, Totals } from "./types";

/**
 * Financial rules mirrored from the prototype (design-reference/IMPLEMENTATION.md):
 * per line, net = qty × unit price; discount = net × disc%; taxable = net − discount;
 * VAT = taxable × rate; total = taxable + VAT. Each line is computed in integer cents
 * and rounded half-up, then lines are summed. The backend's rounding policy is
 * authoritative; these figures are advisory previews only.
 */

export const ZERO_TOTALS: Totals = { net: 0, discount: 0, taxable: 0, vat: 0, total: 0 };

export function lineTotals(item: Pick<OrderItem, "quantity" | "unitPrice" | "discountPct">, vatRate: number): Totals {
  const qtyMilli = Math.round((Number(item.quantity) || 0) * 1000);
  const net = Math.round((qtyMilli * (item.unitPrice || 0)) / 1000);
  const discount = Math.round((net * Math.round((Number(item.discountPct) || 0) * 100)) / 10000);
  const taxable = net - discount;
  const vat = Math.round((taxable * vatRate) / 100);
  return { net, discount, taxable, vat, total: taxable + vat };
}

export function addTotals(a: Totals, b: Totals): Totals {
  return {
    net: a.net + b.net,
    discount: a.discount + b.discount,
    taxable: a.taxable + b.taxable,
    vat: a.vat + b.vat,
    total: a.total + b.total,
  };
}

/** Totals from the lines' own VAT snapshots (not the current product VAT). */
export function orderTotals(items: OrderItem[]): Totals {
  return items.reduce((sum, item) => addTotals(sum, lineTotals(item, item.vatRate)), ZERO_TOTALS);
}

/** Converts an amount to ALL at the rate recorded on the document. */
export function toAllEquivalent(amount: Cents, doc: { currency: Currency; exchangeRate: number }): Cents {
  return doc.currency === "ALL" ? amount : Math.round(amount * doc.exchangeRate);
}

export function paymentStatus(invoice: Pick<Invoice, "total" | "paid" | "dueDate">, today: ISODate): PaymentStatus {
  const outstanding = invoice.total - invoice.paid;
  if (outstanding <= 0) return "Paid";
  if (invoice.dueDate < today) return "Overdue";
  if (invoice.paid > 0) return "Partial";
  return "Unpaid";
}

/* ---------- formatting ---------- */

/** 1,234.50 ALL — two decimals, with a true minus sign. */
export function formatMoney(amount: Cents, currency?: Currency | ""): string {
  const body = (Math.abs(amount) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (amount < 0 ? "−" : "") + body + (currency ? " " + currency : "");
}

/** Whole units, no currency: 1,235 */
export function formatWhole(amount: Cents): string {
  return Math.round(amount / 100).toLocaleString("en-US");
}

/** Cents → editable decimal string ("1234.50"). */
export function centsToInput(amount: Cents): string {
  return (amount / 100).toFixed(2);
}

/** Editable decimal string → cents; NaN-safe (returns 0). */
export function inputToCents(value: string): Cents {
  return Math.round((parseFloat(value) || 0) * 100);
}

export function formatRate(currency: Currency, rate: number): string {
  return currency === "ALL" ? "Not applicable" : `1 ${currency} = ${rate.toFixed(2)} ALL`;
}

/* ---------- dates ---------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-11-16 → "16 Nov 2026" */
export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 864e5);
}

export const MONTH_LABELS = MONTHS;
