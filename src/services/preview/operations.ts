/**
 * In-memory stand-ins for the backend mutations, used only in preview mode.
 *
 * Each function is pure: it takes the current dataset and returns a new one plus
 * the created/changed record. Production replaces these with the matching
 * `SalesFlowApi` calls (see ../api.ts), whose responses are authoritative,
 * including all totals, VAT and rounding.
 */
import { addDays, orderTotals } from "@/lib/money";
import { PREVIEW_TODAY, WAREHOUSE_PICKUP, paymentTermsDays } from "@/mocks/fixtures";
import type { Customer, Invoice, Order, OrderStatus, Payment, Product, SalesDataset } from "@/lib/types";
import type { CreateCustomerInput, CreateOrderInput, CreatePaymentInput, SaveProductInput } from "../api";

const nextNumber = (ids: string[]) => Math.max(0, ...ids.map((id) => Number(id.slice(-4)))) + 1;
const pad4 = (n: number) => String(n).padStart(4, "0");

/** Mirrors POST /api/orders/{id}/status; the server enforces the same transition table. */
export function setOrderStatus(data: SalesDataset, orderId: string, status: OrderStatus): SalesDataset {
  return { ...data, orders: data.orders.map((o) => (o.id === orderId ? { ...o, status } : o)) };
}

export function issueInvoice(data: SalesDataset, orderId: string, today = PREVIEW_TODAY): { data: SalesDataset; invoice: Invoice } {
  const order = data.orders.find((o) => o.id === orderId)!;
  const customer = data.customers.find((c) => c.id === order.customerId)!;
  const id = "INV-2026-" + pad4(nextNumber(data.invoices.map((i) => i.id)));
  const invoice: Invoice = {
    id,
    orderId: order.id,
    customerId: order.customerId,
    repId: order.repId,
    issueDate: today,
    dueDate: addDays(today, paymentTermsDays(customer.size)),
    currency: order.currency,
    exchangeRate: order.exchangeRate,
    net: order.net,
    discount: order.discount,
    taxable: order.taxable,
    vat: order.vat,
    total: order.total,
    paid: 0,
  };
  return {
    invoice,
    data: {
      ...data,
      orders: data.orders.map((o) => (o.id === orderId ? { ...o, invoiceId: id } : o)),
      invoices: [invoice, ...data.invoices],
    },
  };
}

export function createOrder(data: SalesDataset, input: CreateOrderInput): { data: SalesDataset; order: Order } {
  const customer = data.customers.find((c) => c.id === input.customerId)!;
  const id = "SO-2026-" + pad4(nextNumber(data.orders.map((o) => o.id)));
  // Snapshot product name, SKU, unit and VAT onto each line, as the server does.
  const items = input.items.map((it) => {
    const p = data.products.find((x) => x.id === it.productId)!;
    return { ...it, productName: p.name, sku: p.sku, unit: p.unit, vatRate: p.vatRate };
  });
  const order: Order = {
    id,
    customerId: customer.id,
    repId: input.repId || customer.repId,
    date: input.date,
    currency: input.currency,
    exchangeRate: input.exchangeRate,
    status: input.status,
    deliveryAddress: input.deliveryAddressId === "customer" ? customer.street + ", " + customer.city : WAREHOUSE_PICKUP,
    invoiceId: null,
    items,
    ...orderTotals(items),
  };
  return { order, data: { ...data, orders: [order, ...data.orders] } };
}

export function recordPayment(data: SalesDataset, input: CreatePaymentInput): { data: SalesDataset; payment: Payment } {
  const invoice = data.invoices.find((i) => i.id === input.invoiceId)!;
  const n = nextNumber(data.payments.map((p) => p.id));
  const payment: Payment = {
    id: "PAY-2026-" + pad4(n),
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    date: input.date,
    amount: input.amount,
    currency: invoice.currency,
    method: input.method,
    reference: input.reference.trim() || "ARK-" + (500000 + n),
  };
  return {
    payment,
    data: {
      ...data,
      invoices: data.invoices.map((i) => (i.id === invoice.id ? { ...i, paid: i.paid + input.amount } : i)),
      payments: [payment, ...data.payments],
    },
  };
}

export function createCustomer(data: SalesDataset, input: CreateCustomerInput): { data: SalesDataset; customer: Customer } {
  const id = "C-" + (Math.max(...data.customers.map((c) => Number(c.id.slice(2)))) + 1);
  const customer: Customer = { ...input, id };
  return { customer, data: { ...data, customers: [...data.customers, customer] } };
}

export function saveProduct(data: SalesDataset, input: SaveProductInput): { data: SalesDataset; product: Product; created: boolean } {
  const created = !input.id;
  const product: Product = { ...input, id: input.id || "P-" + String(data.products.length + 1).padStart(3, "0") };
  return {
    product,
    created,
    data: {
      ...data,
      products: created ? [...data.products, product] : data.products.map((p) => (p.id === product.id ? product : p)),
    },
  };
}
