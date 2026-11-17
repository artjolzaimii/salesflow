import { z } from "zod";

/** Required trimmed text. */
export const text = (max: number, message = "Required.") => z.string().trim().min(1, message).max(max, `At most ${max} characters.`);

/** Optional trimmed text; "" and null become null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters.`)
    .nullish()
    .transform((v) => v || null);

export const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.").max(255));
export const optionalEmail = z
  .union([z.literal(""), email])
  .nullish()
  .transform((v) => v || null);

const PHONE = /^\+?[0-9][0-9 ]{5,19}$/;
export const optionalPhone = z
  .string()
  .trim()
  .nullish()
  .transform((v) => v || null)
  .refine((v) => v === null || PHONE.test(v), "Use digits only, e.g. +355 69 123 4567.");
export const phone = z.string().trim().regex(PHONE, "Use digits only, e.g. +355 69 123 4567.");

/**
 * Decimal amount as an exact string. Numbers are accepted only if their decimal
 * text already satisfies the limits, so float artefacts are refused, not rounded.
 */
export function decimalString(opts: { maxIntDigits: number; maxDecimals: number; allowZero: boolean; label: string }) {
  const pattern = new RegExp(`^(0|[1-9]\\d{0,${opts.maxIntDigits - 1}})(\\.\\d+)?$`);
  return z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim();
    if (!pattern.test(s)) {
      ctx.addIssue({ code: "custom", message: `${opts.label} must be a ${opts.allowZero ? "non-negative" : "positive"} number.` });
      return z.NEVER;
    }
    const decimals = s.split(".")[1]?.length ?? 0;
    if (decimals > opts.maxDecimals) {
      ctx.addIssue({ code: "custom", message: `${opts.label} can have at most ${opts.maxDecimals} decimal places.` });
      return z.NEVER;
    }
    if (!opts.allowZero && /^0(\.0+)?$/.test(s)) {
      ctx.addIssue({ code: "custom", message: `${opts.label} must be greater than zero.` });
      return z.NEVER;
    }
    return s;
  });
}

/** Field → first message, for forms. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
