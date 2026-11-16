/**
 * Client-side validation, mirrored from the prototype. The server validates again;
 * these checks only give immediate feedback.
 */
import { formatMoney, inputToCents } from "./money";
import type { Customer, InvoiceView, Product } from "./types";

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIPT = /^[A-Z]\d{8}[A-Z]$/;
const PHONE = /^\+?[0-9 ]{8,16}$/;
const POSTAL = /^\d{4}$/;

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

/* ---------- customer registration ---------- */

export interface CustomerForm {
  name: string;
  nipt: string;
  type: string;
  size: string;
  status: "active" | "inactive";
  contact: string;
  position: string;
  phone: string;
  email: string;
  city: string;
  municipality: string;
  street: string;
  postal: string;
  addressType: string;
  repId: string;
  notes: string;
}

export const BLANK_CUSTOMER_FORM: CustomerForm = {
  name: "",
  nipt: "",
  type: "",
  size: "",
  status: "active",
  contact: "",
  position: "",
  phone: "",
  email: "",
  city: "",
  municipality: "",
  street: "",
  postal: "",
  addressType: "Delivery",
  repId: "",
  notes: "",
};

export function validateCustomer(f: CustomerForm, existing: Customer[]): FieldErrors<keyof CustomerForm> {
  const e: FieldErrors<keyof CustomerForm> = {};
  const nipt = f.nipt.trim().toUpperCase();
  if (!f.name.trim()) e.name = "Business name is required.";
  if (!NIPT.test(nipt)) e.nipt = "NIPT is one letter, eight digits, one letter (e.g. L12345678A).";
  else if (existing.some((c) => c.nipt === nipt)) e.nipt = "A customer with this NIPT already exists.";
  if (!f.type) e.type = "Select a business type.";
  if (!f.size) e.size = "Select a business size.";
  if (!f.contact.trim()) e.contact = "Contact name is required.";
  if (!PHONE.test(f.phone.trim())) e.phone = "Use digits only, e.g. +355 69 123 4567.";
  if (f.email && !EMAIL.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.city) e.city = "Select a city.";
  if (!f.street.trim()) e.street = "Street address is required.";
  if (f.postal && !POSTAL.test(f.postal.trim())) e.postal = "Albanian postal codes have four digits.";
  if (!f.repId) e.repId = "Assign a sales representative.";
  return e;
}

/* ---------- product ---------- */

export interface ProductForm {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: string;
  vatRate: string;
  status: "active" | "inactive";
}

export function validateProduct(f: ProductForm, existing: Product[]): FieldErrors<"name" | "sku" | "category" | "unit" | "price"> {
  const e: FieldErrors<"name" | "sku" | "category" | "unit" | "price"> = {};
  if (!f.name.trim()) e.name = "Product name is required.";
  if (!f.sku.trim()) e.sku = "SKU is required.";
  else if (existing.some((p) => p.sku === f.sku.trim().toUpperCase() && p.id !== f.id)) e.sku = "SKU already in use.";
  if (!f.category) e.category = "Select a category.";
  if (!f.unit.trim()) e.unit = "Unit is required.";
  if (!(parseFloat(f.price) > 0)) e.price = "Enter a net price above zero.";
  return e;
}

/* ---------- order lines ---------- */

export interface DraftLine {
  key: number;
  productId: string;
  quantity: string;
  price: string;
  discount: string;
}

export const lineChecks = {
  quantityInvalid: (l: DraftLine) => l.quantity !== "" && !(Number(l.quantity) > 0),
  priceInvalid: (l: DraftLine) => l.price !== "" && !(parseFloat(l.price) >= 0),
  discountInvalid: (l: DraftLine) => !(Number(l.discount) >= 0 && Number(l.discount) <= 100),
};

export function validateOrderDraft(d: { customerId: string; currency: string; rate: string; lines: DraftLine[] }): string | null {
  const rate = d.currency === "ALL" ? 1 : parseFloat(d.rate);
  const lines = d.lines.filter((l) => l.productId);
  if (!d.customerId) return "Select a customer.";
  if (!(rate > 0)) return "Enter a valid exchange rate.";
  if (!lines.length) return "Add at least one product line.";
  if (lines.some((l) => !(Number(l.quantity) > 0) || !(parseFloat(l.price) >= 0) || lineChecks.discountInvalid(l)))
    return "Check highlighted lines: quantity must be above zero and discount between 0 and 100%.";
  return null;
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
