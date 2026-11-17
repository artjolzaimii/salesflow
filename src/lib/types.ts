/**
 * SalesFlow domain models.
 *
 * These interfaces describe the records the frontend works with. They mirror the
 * assumed API contracts in design-reference/IMPLEMENTATION.md and must be checked
 * against the approved Prisma schema before the PostgreSQL integration.
 *
 * Conventions
 * - Money is stored as integer minor units (cents) in the record's own currency.
 * - Dates are ISO calendar dates (YYYY-MM-DD) with no time zone.
 */

export type Cents = number;
export type ISODate = string;

export type Currency = "ALL" | "EUR" | "USD";
export const CURRENCIES: readonly Currency[] = ["ALL", "EUR", "USD"];

export type DataState = "ready" | "loading" | "empty" | "error";

/** Operational status. "Invoiced" is not a status: it is derived from `Order.invoiceId`. */
export type OrderStatus = "Draft" | "Confirmed" | "Processing" | "Delivered" | "Cancelled";
export type PaymentStatus = "Unpaid" | "Partial" | "Paid" | "Overdue";
export type PaymentMethod = "Bank transfer" | "Cash" | "Card";
export type BusinessType = "Supermarket" | "Grocery" | "Restaurant" | "Hotel" | "Café" | "Wholesale";
export type BusinessSize = "Small" | "Medium" | "Large";
export type AddressType = "Delivery" | "Billing" | "Registered office";

export interface Employee {
  id: string;
  name: string;
  /** Territory description, e.g. "Tiranë · Fier". */
  region: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  /** Default net price in ALL cents, excluding VAT. */
  price: Cents;
  /** VAT rate in percent (20, 10, 6, 0). */
  vatRate: number;
  active: boolean;
}

export interface Customer {
  id: string;
  name: string;
  /** Albanian tax ID: one letter, eight digits, one letter. */
  nipt: string;
  city: string;
  type: BusinessType;
  size: BusinessSize;
  /** Assigned sales representative (Employee.id). */
  repId: string;
  active: boolean;
  contactName: string;
  contactPosition: string;
  phone: string;
  email: string;
  street: string;
  postalCode: string;
  municipality: string;
  addressType: AddressType;
  notes: string;
}

/**
 * An order line. Name, SKU, unit and VAT rate are snapshots taken when the line
 * was created; historical orders render from them, never from the current
 * product record.
 */
export interface OrderItem {
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  vatRate: number;
  quantity: number;
  discountPct: number;
  /** Unit price in the order currency, cents, excluding VAT. */
  unitPrice: Cents;
}

export interface Totals {
  net: Cents;
  discount: Cents;
  taxable: Cents;
  vat: Cents;
  total: Cents;
}

export interface Order extends Totals {
  id: string;
  customerId: string;
  repId: string;
  date: ISODate;
  currency: Currency;
  /** ALL per 1 unit of the order currency; 1 for ALL orders. */
  exchangeRate: number;
  status: OrderStatus;
  deliveryAddress: string;
  /** Issued invoice, if any. Its presence is what "Invoiced" means. */
  invoiceId: string | null;
  items: OrderItem[];
}

export interface Invoice extends Totals {
  id: string;
  orderId: string;
  customerId: string;
  repId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  currency: Currency;
  /** Rate snapshot frozen when the invoice is issued. */
  exchangeRate: number;
  /** Sum of recorded payments, cents, invoice currency. */
  paid: Cents;
}

/** Invoice with server-derived payment fields. */
export interface InvoiceView extends Invoice {
  outstanding: Cents;
  status: PaymentStatus;
}

export interface Payment {
  id: string;
  invoiceId: string;
  customerId: string;
  date: ISODate;
  amount: Cents;
  currency: Currency;
  method: PaymentMethod;
  reference: string;
}

/* ---------- AI assistant ---------- */

export interface AssistantTable {
  columns: string[];
  rows: [string, string, string][];
}

export interface AssistantKpi {
  label: string;
  value: string;
}

export type AssistantMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; table?: AssistantTable; kpis?: AssistantKpi[] }
  | { role: "error"; text: string };

export interface Conversation {
  id: string;
  title: string;
  updatedLabel: string;
  /** True for the canned transcripts shipped with the preview. */
  fixture: boolean;
  messages: AssistantMessage[];
}

/** Everything the preview needs; production loads these per endpoint. */
export interface SalesDataset {
  employees: Employee[];
  products: Product[];
  customers: Customer[];
  orders: Order[];
  invoices: Invoice[];
  payments: Payment[];
}
