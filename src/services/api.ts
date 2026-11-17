/**
 * API integration boundary.
 *
 * The frontend talks to the backend only through the contract below. In this
 * phase there is no backend: the preview store (src/store) satisfies these
 * calls in memory with the operations in ./preview/operations.ts. When the
 * PostgreSQL/Prisma services exist, implement `SalesFlowApi` with fetch calls to
 * the endpoints listed here and swap it in; screens do not need to change.
 *
 * Every endpoint is an assumption from design-reference/IMPLEMENTATION.md and
 * must be confirmed against the approved schema.
 */
import type { Currency, Invoice, Payment, PaymentMethod } from "@/lib/types";
import type { ClientSessionUser } from "@/lib/session-user";

export const API_ENDPOINTS = {
  // Live (Phase 5A/5B). Customers also: PATCH /api/customers/:id, contacts and addresses sub-resources;
  // employees: GET/POST /api/employees, GET/PATCH /api/employees/:id, POST /api/employees/:id/reassign;
  // catalogue: GET/PATCH /api/products/:id, GET/POST /api/categories, PATCH/DELETE /api/categories/:id;
  // exchange rates: GET/POST /api/exchange-rates, GET /api/exchange-rates/applicable;
  // orders (Phase 5C): GET/POST /api/orders, POST /api/orders/quote, GET/PATCH /api/orders/:id,
  // POST /api/orders/:id/confirm, POST /api/orders/:id/status. See docs/api.md.
  login: "POST /api/auth/callback/credentials (Auth.js; the app uses a server action)",
  session: "GET /api/me",
  orderDetail: "GET /api/orders/:id",
  orderStatus: "POST /api/orders/:id/status",
  cancelInvoice: "POST /api/invoices/:id/cancel",
  replaceInvoice: "POST /api/invoices/:id/replacement",
  dashboard: "GET /api/dashboard/summary",
  customers: "GET /api/customers",
  createCustomer: "POST /api/customers",
  customer: "GET /api/customers/:id",
  products: "GET /api/products",
  createProduct: "POST /api/products",
  updateProduct: "PATCH /api/products/:id",
  orders: "GET /api/orders",
  createOrder: "POST /api/orders",
  updateOrder: "PATCH /api/orders/:id",
  quoteOrder: "POST /api/orders/quote",
  confirmOrder: "POST /api/orders/:id/confirm",
  invoiceOrder: "POST /api/orders/:id/invoice (not implemented yet)",
  invoices: "GET /api/invoices",
  invoice: "GET /api/invoices/:id",
  payments: "GET /api/payments",
  createPayment: "POST /api/payments",
  salesReport: "GET /api/reports/sales",
  conversations: "GET /api/assistant/conversations",
  sendMessage: "POST /api/assistant/conversations/:id/messages",
} as const;

/** GET /api/me. Data scoping (reps: own customers) is applied on the server. */
export type Session = ClientSessionUser;

export interface CreatePaymentInput {
  invoiceId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  reference: string;
}


export interface SalesReportQuery {
  from: string;
  to: string;
  groupBy: "rep" | "customer" | "product" | "currency" | "outstanding";
  currency: Currency | "ALL_EQ";
}

/**
 * Contract for the modules still in preview. Customers, employees, products,
 * categories, exchange rates and orders are live (see API_ENDPOINTS above and
 * src/services/client/); their screens call those routes directly.
 */
export interface SalesFlowApi {
  getSession(): Promise<Session>;
  invoiceOrder(id: string): Promise<Invoice>;
  listInvoices(): Promise<Invoice[]>;
  listPayments(): Promise<Payment[]>;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
}
