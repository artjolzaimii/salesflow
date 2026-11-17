import { z } from "zod";
import { FOREIGN_CURRENCIES, VAT_RATES } from "@/lib/labels";
import { decimalString, text } from "./common";

/** numeric(18,4): up to 14 integer digits, 4 decimals; net ALL, excluding VAT. */
export const productPrice = decimalString({ maxIntDigits: 14, maxDecimals: 4, allowZero: true, label: "Net price" });

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,59}$/, "SKU uses letters, digits, '.', '_' or '-' (max 60).");

export const productSchema = z.object({
  sku: skuSchema,
  name: text(255, "Product name is required."),
  categoryId: z.uuid("Select a category."),
  unit: text(30, "Unit is required."),
  defaultNetAll: productPrice,
  vatRate: z.union([z.enum(VAT_RATES), z.number().transform(String).pipe(z.enum(VAT_RATES))], "VAT rate must be 20, 10, 6 or 0%."),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.input<typeof productSchema>;
export const productPatchSchema = productSchema.partial().refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const categorySchema = z.object({
  name: text(120, "Category name is required."),
  parentId: z.uuid().nullish().transform((v) => v ?? null),
});
export const categoryPatchSchema = z
  .object({ name: text(120, "Category name is required."), parentId: z.uuid().nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** numeric(20,8): 1 unit of foreign currency = X ALL. Manual entry only. */
export const rateValue = decimalString({ maxIntDigits: 12, maxDecimals: 8, allowZero: false, label: "Rate" });

export const exchangeRateSchema = z.object({
  currencyCode: z.enum(FOREIGN_CURRENCIES, "Rates are entered for EUR or USD; ALL is the base currency (always 1)."),
  allPerUnit: rateValue.refine((v) => Number(v) < 100_000, "Rate looks implausible (1 unit ≥ 100,000 ALL)."),
  /** YYYY-MM-DD (start of day, UTC) or a full ISO timestamp. */
  effectiveAt: z
    .string()
    .trim()
    .refine((s) => /^\d{4}-\d{2}-\d{2}(T.+)?$/.test(s) && !Number.isNaN(Date.parse(s.length === 10 ? s + "T00:00:00Z" : s)), "Use a date (YYYY-MM-DD).")
    .transform((s) => new Date(s.length === 10 ? s + "T00:00:00Z" : s))
    .refine((d) => d.getUTCFullYear() >= 2000, "Date is too far in the past."),
});
