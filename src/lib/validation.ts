/**
 * Client-side validation, mirrored from the prototype. The server validates again;
 * these checks only give immediate feedback.
 */
import { formatMoney, inputToCents } from "./money";
import type { InvoiceView } from "./types";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- login ---------- */

export interface LoginForm {
  email: string;
  password: string;
}

export function validateLogin(f: LoginForm): FieldErrors<keyof LoginForm> {
  const e: FieldErrors<keyof LoginForm> = {};
  if (!EMAIL.test(f.email.trim())) e.email = "Enter your work email.";
  if (f.password.length < 8) e.password = "Password must be at least 8 characters.";
  return e;
}

/* ---------- payment ---------- */

export interface PaymentForm {
  invoiceId: string;
  amount: string;
  date: string;
  method: "Bank transfer" | "Cash" | "Card";
  reference: string;
}

/** Inline amount check shown while typing. */
export function paymentAmountError(f: PaymentForm, invoice: InvoiceView | undefined): string {
  if (f.amount === "") return "";
  const amt = inputToCents(f.amount);
  if (amt <= 0) return "Enter an amount greater than zero.";
  if (invoice && amt > invoice.outstanding) return "Exceeds the outstanding balance of " + formatMoney(invoice.outstanding, invoice.currency) + ".";
  return "";
}

/** Full check on submit. */
export function validatePayment(f: PaymentForm, invoice: InvoiceView | undefined): string | null {
  if (!invoice) return "Select an invoice.";
  const amt = inputToCents(f.amount);
  if (amt <= 0 || amt > invoice.outstanding) return "Enter an amount between 0.01 and " + formatMoney(invoice.outstanding, invoice.currency) + ".";
  if (!f.date) return "Enter the payment date.";
  if (f.method !== "Cash" && !f.reference.trim()) return "Enter the bank or POS reference.";
  return null;
}
