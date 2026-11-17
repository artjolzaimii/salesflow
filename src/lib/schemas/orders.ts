import { z } from "zod";
import { CURRENCY_CODES } from "@/lib/labels";
import { decimalString } from "./common";

/**
 * Order input, shared by the API (authoritative) and the order form (early
 * feedback). Amounts are exact decimal strings; the server prices every line
 * itself and never accepts totals from the browser.
 */

/** numeric(18,3): up to 9 integer digits here (1e9 units is far beyond any real line). */
export const quantity = decimalString({ maxIntDigits: 9, maxDecimals: 3, allowZero: false, label: "Quantity" });
/** numeric(18,4) unit price in the order currency, excluding VAT. */
export const unitPrice = decimalString({ maxIntDigits: 14, maxDecimals: 4, allowZero: true, label: "Unit price" });
/** numeric(5,2) between 0 and 100. */
export const discountPercent = decimalString({ maxIntDigits: 3, maxDecimals: 2, allowZero: true, label: "Discount" }).refine(
  (v) => Number(v) <= 100,
  "Discount must be between 0 and 100%.",
);

export const MAX_ORDER_LINES = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const orderDate = z
  .string()
  .regex(DATE, "Use a date like 2026-11-17.")
  .refine((s) => {
    const d = new Date(s + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) && d.getUTCFullYear() >= 2000;
  }, "Enter a valid order date.");

export const orderLineSchema = z.object({
  /** Existing item id when editing; lets an unchanged manager-set price survive a representative's edit. */
  id: z.uuid().optional(),
  productId: z.uuid("Select a product."),
  quantity,
  /** Omit to use the catalogue price converted at the order rate. A different value is a price override. */
  unitNetPrice: unitPrice.nullish().transform((v) => v ?? null),
  discountPercent: discountPercent.default("0"),
});
export type OrderLineInput = z.input<typeof orderLineSchema>;

export const orderBodySchema = z.object({
  customerId: z.uuid("Select a customer."),
  /** Managers and admins choose; representatives are always attributed to themselves. */
  salesRepId: z.uuid("Select a sales representative.").nullish().transform((v) => v ?? null),
  orderDate,
  currencyCode: z.enum(CURRENCY_CODES, "Currency must be ALL, EUR or USD."),
  /** A customer address, or null for pickup at the warehouse. */
  deliveryAddressId: z.uuid().nullish().transform((v) => v ?? null),
  lines: z.array(orderLineSchema).min(1, "Add at least one product line.").max(MAX_ORDER_LINES, `At most ${MAX_ORDER_LINES} lines per order.`),
});
export type OrderBodyInput = z.input<typeof orderBodySchema>;

export const orderCreateSchema = orderBodySchema.extend({
  status: z.enum(["DRAFT", "CONFIRMED"]).default("DRAFT"),
});
export type OrderCreateInput = z.input<typeof orderCreateSchema>;

/** Editing replaces the whole order body. `version` is the updatedAt the editor loaded (optimistic concurrency). */
export const orderUpdateSchema = orderBodySchema.extend({
  version: z.string().min(1, "Missing order version; reload the order."),
});
export type OrderUpdateInput = z.input<typeof orderUpdateSchema>;

/** Quote: price an order without saving it. `orderId` lets an edit keep its existing overrides. */
export const orderQuoteSchema = orderBodySchema.extend({
  orderId: z.uuid().optional(),
});

export const confirmSchema = z.object({ version: z.string().min(1).optional() });
