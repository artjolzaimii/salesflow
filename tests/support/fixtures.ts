import { randomUUID } from "node:crypto";
import type { OrderStatus } from "@/generated/prisma/client";
import type { Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { computeLine, sumTotals, unitPriceInCurrency } from "@/server/domain/pricing";
import { businessDate } from "@/lib/business-date";

export const db = () => getDb();

/** Principal for a seeded user, loaded the same way the session layer does. */
export async function principalFor(email: string): Promise<Principal> {
  const u = await db().user.findUniqueOrThrow({ where: { email }, include: { employee: true } });
  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    employeeId: u.employee?.id ?? null,
    name: u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : u.email,
  };
}

export const ADMIN = "admin@salesflow.test";
export const MANAGER = "manager@salesflow.test";
export const REP_TIRANA = "rep.tirana@salesflow.test"; // assigned: Market Alba, Distribucion Adriatik, Ushqimore Shkodra
export const REP_KORCE = "rep.korce@salesflow.test"; // assigned: Restorant Liqeni, Hotel Korca

let seq = 0;

interface OrderSpec {
  nipt: string;
  status?: OrderStatus;
  currency?: "ALL" | "EUR" | "USD";
  rate?: string;
  lines?: { sku: string; qty: string; discount?: string }[];
  /** YYYY-MM-DD; default now. */
  orderDate?: string;
}

/** A fresh order for one test, priced with the production pricing rules. */
export async function createOrder(spec: OrderSpec) {
  const customer = await db().customer.findUniqueOrThrow({ where: { nipt: spec.nipt } });
  const currency = spec.currency ?? "ALL";
  const rate = spec.rate ?? "1";
  const lines = spec.lines ?? [{ sku: "DRK-001", qty: "10" }];
  const items = await Promise.all(
    lines.map(async (l) => {
      const p = await db().product.findUniqueOrThrow({ where: { sku: l.sku } });
      const unitNetPrice = unitPriceInCurrency(p.defaultNetAll, rate);
      const amounts = computeLine({ quantity: l.qty, unitNetPrice, discountPercent: l.discount ?? "0", vatRate: p.vatRate });
      return {
        productId: p.id,
        productSku: p.sku,
        productName: p.name,
        unit: p.unit,
        quantity: l.qty,
        unitNetPrice,
        discountPercent: l.discount ?? "0",
        vatRate: p.vatRate,
        ...amounts,
      };
    }),
  );
  const totals = sumTotals(items);
  return db().order.create({
    data: {
      orderNumber: `T-${Date.now()}-${++seq}`,
      customerId: customer.id,
      salesRepId: customer.assignedRepId!,
      currencyCode: currency,
      allPerUnit: rate,
      status: spec.status ?? "CONFIRMED",
      ...(spec.orderDate ? { orderDate: new Date(spec.orderDate + "T00:00:00Z") } : {}),
      ...totals,
      items: { create: items },
    },
  });
}

/** Issues an invoice that snapshots the order (direct insert, as the guard expects). */
export async function invoiceOrder(orderId: string, opts: { replaces?: string; number?: string; issueDate?: string; dueDate?: string } = {}) {
  const o = await db().order.findUniqueOrThrow({ where: { id: orderId } });
  return db().invoice.create({
    data: {
      invoiceNumber: opts.number ?? `TI-${Date.now()}-${++seq}`,
      orderId: o.id,
      replacesInvoiceId: opts.replaces,
      currencyCode: o.currencyCode,
      allPerUnit: o.allPerUnit,
      subtotalNet: o.subtotalNet,
      discountTotal: o.discountTotal,
      taxableTotal: o.taxableTotal,
      vatTotal: o.vatTotal,
      total: o.grandTotal,
      issueDate: new Date((opts.issueDate ?? "2026-11-01") + "T00:00:00Z"),
      dueDate: new Date((opts.dueDate ?? "2026-12-01") + "T00:00:00Z"),
    },
  });
}

export async function invoicedOrder(spec: OrderSpec & { issueDate?: string; dueDate?: string }) {
  const order = await createOrder(spec);
  const invoice = await invoiceOrder(order.id, { issueDate: spec.issueDate, dueDate: spec.dueDate });
  return { order, invoice };
}

export const key = () => "test-" + randomUUID();

export const NIPT = {
  marketAlba: "L12345678A", // rep.tirana
  adriatik: "L23456789B", // rep.tirana
  liqeni: "L34567890C", // rep.korce
  hotelKorca: "L45678901D", // rep.korce
};

/** The AppError code a promise rejects with (Zod failures count as VALIDATION_FAILED, as over HTTP). */
export async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if ((e as Error)?.name === "ZodError") return "VALIDATION_FAILED";
    return (e as { code?: string }).code ?? String(e);
  }
  return "RESOLVED";
}

/** Field paths a Zod validation failure reported. */
export async function invalidFields(p: Promise<unknown>): Promise<string[]> {
  try {
    await p;
  } catch (e) {
    const issues = (e as { issues?: { path: (string | number)[] }[] }).issues;
    if (issues) return issues.map((i) => i.path.join("."));
    throw e;
  }
  return [];
}

let uniq = 0;
/** A valid, unused NIPT for this test run. */
export const freshDigits = () => String(((Date.now() % 1e6) * 100 + (++uniq % 100)) % 1e8).padStart(8, "0");
export const freshNipt = () => `T${freshDigits()}Z`;

/** The PostgreSQL message behind a rejected Prisma call (guard triggers, CHECKs). */
export async function dbError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }).meta?.driverAdapterError?.cause;
    return cause?.originalMessage ?? (e as Error).message;
  }
  return "RESOLVED";
}

/** Business date (Europe/Tirane) shifted by whole days, YYYY-MM-DD. */
export function daysFromToday(days: number): string {
  const d = new Date(businessDate() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** next_invoice_number() output: internal INV-<year>-<6 digits>. */
export const INVOICE_NUMBER = /^INV-\d{4}-\d{6}$/;
export const invoiceSeq = (n: string) => Number(n.slice(-6));
