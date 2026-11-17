import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";

/**
 * Monetary arithmetic uses Prisma.Decimal (decimal.js) with ROUND_HALF_UP,
 * never JavaScript floats.
 */
export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type DecimalValue = Prisma.Decimal | string | number;

export const D = (v: DecimalValue) => new Prisma.Decimal(v);
export const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const round4 = (v: Prisma.Decimal) => v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);

/** Up to 16 integer digits (numeric(18,2)) and at most two decimals. */
const AMOUNT_PATTERN = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;

/**
 * A payment or money amount from untrusted input. Values with more than two
 * decimals are rejected (numeric(18,2) would otherwise round 10.005 to 10.01
 * silently). Numbers are accepted only if their exact decimal text has ≤ 2 dp,
 * so float artefacts like 0.1 + 0.2 are refused rather than rounded.
 */
export const positiveAmount = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    const text = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim();
    if (!AMOUNT_PATTERN.test(text)) {
      ctx.addIssue({
        code: "custom",
        message: /\.\d{3,}$/.test(text) ? "Amount must have at most two decimal places." : "Amount must be a positive decimal number.",
      });
      return z.NEVER;
    }
    const amount = D(text);
    if (amount.lte(0)) {
      ctx.addIssue({ code: "custom", message: "Amount must be greater than zero." });
      return z.NEVER;
    }
    return amount;
  });

/** YYYY-MM-DD calendar date (stored in DATE columns, no time zone). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().startsWith(s), "Not a valid date.")
  .transform((s) => new Date(s + "T00:00:00Z"));
