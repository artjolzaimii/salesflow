import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { businessDate, utcDate } from "@/lib/business-date";
import type { orderBodySchema } from "@/lib/schemas/orders";
import { hasPermission, isScoped, type Principal } from "@/server/auth/principal";
import { customerScope } from "@/server/auth/scope";
import { D, type Decimal } from "@/server/domain/money";
import { computeLine, sumTotals, unitPriceInCurrency, type LineAmounts, type OrderTotals } from "@/server/domain/pricing";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/errors";

/**
 * The single place where an order is priced. Order creation, editing, the
 * live quote and confirmation all go through here, so the rules cannot drift:
 *
 * - Catalogue prices are net ALL. For EUR/USD the unit price is
 *   round4(defaultNetAll / rate), using the manually entered rate in effect on
 *   the order date; that rate is snapshotted on the order (`all_per_unit`).
 * - A unit price different from that catalogue price is an override, allowed
 *   only with `prices.override` (managers, admins). An override already on the
 *   order survives an edit by someone without the permission if it is unchanged.
 * - Lines: gross = round2(qty × price); discount = round2(gross × pct / 100);
 *   taxable = gross − discount; VAT = round2(taxable × rate / 100). Decimal
 *   arithmetic, HALF_UP (src/server/domain/pricing.ts).
 * - Totals are recomputed here from the lines. Totals sent by the browser are
 *   never read: the schemas do not even accept them.
 */

export type Db = Prisma.TransactionClient;
export type OrderBody = z.output<typeof orderBodySchema>;

/** The stored order an edit or quote starts from (for preserved overrides and attribution). */
export interface ExistingOrder {
  customerId: string;
  salesRepId: string;
  currencyCode: string;
  allPerUnit: Decimal;
  items: { id: string; productId: string; unitNetPrice: Decimal }[];
}

export interface AppliedRate {
  currencyCode: string;
  allPerUnit: Decimal;
  /** Null for ALL (always 1). */
  rateId: string | null;
  effectiveAt: Date | null;
}

export interface PricedLine extends LineAmounts {
  productId: string;
  productSku: string;
  productName: string;
  unit: string;
  quantity: Decimal;
  unitNetPrice: Decimal;
  discountPercent: Decimal;
  vatRate: Decimal;
  /** Catalogue price converted at the order rate, for comparison. */
  catalogueUnitPrice: Decimal;
  priceOverride: boolean;
}

export interface PricedOrder {
  customer: { id: string; businessName: string; status: string; assignedRepId: string | null };
  salesRepId: string;
  orderDate: Date;
  deliveryAddressId: string | null;
  deliverySnapshot: Prisma.InputJsonValue;
  rate: AppliedRate;
  lines: PricedLine[];
  totals: OrderTotals;
}

export const WAREHOUSE_PICKUP_LABEL = "Pickup at warehouse";

const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);

/**
 * Rate in effect on an order date: the latest manual entry effective before the
 * end of that calendar day. Rates are append-only, so this never changes for a
 * past date unless someone back-dates a new entry (confirmation detects that).
 */
export async function applicableRate(db: Db, currencyCode: string, orderDate: Date): Promise<AppliedRate | null> {
  if (currencyCode === "ALL") return { currencyCode, allPerUnit: D(1), rateId: null, effectiveAt: null };
  const endOfDay = new Date(orderDate.getTime() + 86_400_000);
  const r = await db.exchangeRate.findFirst({
    where: { currencyCode, effectiveAt: { lt: endOfDay } },
    orderBy: { effectiveAt: "desc" },
  });
  return r ? { currencyCode, allPerUnit: r.allPerUnit, rateId: r.id, effectiveAt: r.effectiveAt } : null;
}

export function noRateError(currencyCode: string, orderDate: Date) {
  return new AppError(
    409,
    "NO_EXCHANGE_RATE",
    `No ${currencyCode} exchange rate is in effect on ${fmtDate(orderDate)}. A manager or admin must enter one under Settings → Exchange rates before this order can be saved or confirmed in ${currencyCode}.`,
    { currencyCode: [`No ${currencyCode} rate in effect on ${fmtDate(orderDate)}.`] },
  );
}

export async function requireRate(db: Db, currencyCode: string, orderDate: Date): Promise<AppliedRate> {
  const rate = await applicableRate(db, currencyCode, orderDate);
  if (!rate) throw noRateError(currencyCode, orderDate);
  return rate;
}

/** Prices one line from its stored or entered values (used by every path). */
export function priceLine(l: { quantity: Decimal | string; unitNetPrice: Decimal | string; discountPercent: Decimal | string; vatRate: Decimal | string }): LineAmounts {
  return computeLine(l);
}

export function priceLines<T extends Parameters<typeof priceLine>[0]>(lines: T[]): { lines: (T & LineAmounts)[]; totals: OrderTotals } {
  const priced = lines.map((l) => ({ ...l, ...priceLine(l) }));
  return { lines: priced, totals: sumTotals(priced) };
}

/**
 * Validates and prices a full order body for the caller. Throws:
 * 404 customer out of scope · 409 CUSTOMER_NOT_ACTIVE / NO_EXCHANGE_RATE ·
 * 422 field problems · 403 PRICE_OVERRIDE_FORBIDDEN or rep attribution.
 */
export async function priceOrder(db: Db, p: Principal, input: OrderBody, existing?: ExistingOrder): Promise<PricedOrder> {
  const problems: Record<string, string[]> = {};
  const add = (k: string, m: string) => (problems[k] ??= []).push(m);

  // Customer: representatives may only order for customers assigned to them. An
  // edit that keeps the order's customer is allowed even if it was reassigned.
  const keepsCustomer = existing?.customerId === input.customerId;
  const customer = await db.customer.findFirst({
    where: keepsCustomer ? { id: input.customerId } : { AND: [{ id: input.customerId }, customerScope(p)] },
    select: { id: true, businessName: true, status: true, assignedRepId: true },
  });
  if (!customer) throw notFound("Customer");
  if (customer.status !== "ACTIVE") {
    throw conflict("CUSTOMER_NOT_ACTIVE", `${customer.businessName} is ${customer.status.toLowerCase()}; orders can't be placed or changed for it.`);
  }

  // Sales representative attribution. Kept on the order even if the customer is reassigned later.
  let salesRepId: string;
  if (isScoped(p)) {
    const own = existing?.salesRepId ?? p.employeeId;
    if (!own) throw forbidden("Your user has no employee record, so orders can't be attributed to you.");
    if (input.salesRepId && input.salesRepId !== own) throw forbidden("Representatives can't attribute orders to someone else.");
    salesRepId = own;
  } else {
    const chosen = input.salesRepId ?? existing?.salesRepId ?? customer.assignedRepId;
    if (!chosen) {
      add("salesRepId", "Select a sales representative.");
      salesRepId = "";
    } else {
      salesRepId = chosen;
      if (chosen !== existing?.salesRepId) {
        const rep = await db.employee.findUnique({ where: { id: chosen }, select: { isActive: true } });
        if (!rep || !rep.isActive) add("salesRepId", "Select an active employee.");
      }
    }
  }

  // Order date: a calendar day, not in the future (Europe/Tirane).
  if (input.orderDate > businessDate()) add("orderDate", "Order date can't be in the future.");
  const orderDate = utcDate(input.orderDate);

  // Delivery: one of the customer's addresses, snapshotted; or warehouse pickup.
  let deliverySnapshot: Prisma.InputJsonValue = { pickup: true, label: WAREHOUSE_PICKUP_LABEL };
  if (input.deliveryAddressId) {
    const a = await db.customerAddress.findFirst({ where: { id: input.deliveryAddressId, customerId: customer.id } });
    if (!a) add("deliveryAddressId", "Choose one of this customer's addresses.");
    else
      deliverySnapshot = {
        addressId: a.id,
        label: a.label,
        type: a.type,
        street: a.street,
        city: a.city,
        municipality: a.municipality,
        postalCode: a.postalCode,
      };
  }

  // Products.
  const ids = [...new Set(input.lines.map((l) => l.productId))];
  const products = new Map((await db.product.findMany({ where: { id: { in: ids } } })).map((x) => [x.id, x]));
  const existingItems = new Map((existing?.items ?? []).map((i) => [i.id, i]));
  input.lines.forEach((l, i) => {
    const prod = products.get(l.productId);
    if (!prod) add(`lines.${i}.productId`, "Product not found.");
    else if (!prod.isActive && !(l.id && existingItems.get(l.id)?.productId === l.productId)) {
      add(`lines.${i}.productId`, `${prod.name} is inactive and can't be added to orders.`);
    }
  });
  if (Object.keys(problems).length) throw invalid("Check the highlighted fields.", problems);

  const rate = await requireRate(db, input.currencyCode, orderDate);

  // Lines and override checks.
  const mayOverride = hasPermission(p, "prices.override");
  const sameRate = !!existing && existing.currencyCode === input.currencyCode && existing.allPerUnit.eq(rate.allPerUnit);
  const overrideProblems: Record<string, string[]> = {};
  const lines: PricedLine[] = input.lines.map((l, i) => {
    const prod = products.get(l.productId)!;
    const catalogueUnitPrice = unitPriceInCurrency(prod.defaultNetAll, rate.allPerUnit);
    const unitNetPrice = l.unitNetPrice === null ? catalogueUnitPrice : D(l.unitNetPrice);
    const priceOverride = !unitNetPrice.eq(catalogueUnitPrice);
    if (priceOverride && !mayOverride) {
      const prev = l.id ? existingItems.get(l.id) : undefined;
      const preserved = sameRate && !!prev && prev.productId === l.productId && prev.unitNetPrice.eq(unitNetPrice);
      if (!preserved) (overrideProblems[`lines.${i}.unitNetPrice`] = [`Only managers and admins can change the price. Catalogue price: ${catalogueUnitPrice.toFixed(4)}.`]);
    }
    const base = {
      productId: prod.id,
      productSku: prod.sku,
      productName: prod.name,
      unit: prod.unit,
      quantity: D(l.quantity),
      unitNetPrice,
      discountPercent: D(l.discountPercent),
      vatRate: prod.vatRate,
    };
    return { ...base, ...priceLine(base), catalogueUnitPrice, priceOverride };
  });
  if (Object.keys(overrideProblems).length) {
    throw new AppError(403, "PRICE_OVERRIDE_FORBIDDEN", "Only managers and admins can change catalogue prices.", overrideProblems);
  }

  return {
    customer,
    salesRepId,
    orderDate,
    deliveryAddressId: input.deliveryAddressId,
    deliverySnapshot,
    rate,
    lines,
    totals: sumTotals(lines),
  };
}

/** Decimal → API string at the column's scale. */
export const money2 = (d: Decimal) => d.toFixed(2);

export function totalsDto(t: OrderTotals) {
  return {
    subtotalNet: money2(t.subtotalNet),
    discountTotal: money2(t.discountTotal),
    taxableTotal: money2(t.taxableTotal),
    vatTotal: money2(t.vatTotal),
    grandTotal: money2(t.grandTotal),
  };
}
