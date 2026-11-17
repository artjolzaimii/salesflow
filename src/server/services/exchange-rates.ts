import "server-only";
import { z } from "zod";
import { FOREIGN_CURRENCIES } from "@/lib/labels";
import { exchangeRateSchema } from "@/lib/schemas/catalog";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { mapDatabaseError } from "@/server/errors";
import { listQuery, paged, skipTake } from "@/server/query";
import { applicableRate, noRateError } from "./order-pricing";

/**
 * Manually entered reference rates: 1 unit of EUR or USD = allPerUnit ALL.
 * ALL is the base currency (always 1). No external rate feed is used.
 *
 * The table is append-only: a correction is a new entry with a later
 * effectiveAt. Orders and invoices copy the rate they used (all_per_unit), so
 * entering or correcting a rate never changes a historical transaction.
 */
export const rateListQuery = listQuery(["effectiveAt", "createdAt"] as const, "effectiveAt", "desc").extend({
  currency: z.enum(FOREIGN_CURRENCIES).optional(),
});

/** Exact rate text with trailing zeros trimmed but at least 2 decimals: "97.8" → "97.80", "97.12345678". */
export function rateText(d: { toFixed: (n: number) => string }) {
  const [int, frac] = d.toFixed(8).split(".");
  return `${int}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

const toRate = (r: { id: string; currencyCode: string; allPerUnit: { toFixed: (n: number) => string }; effectiveAt: Date; createdAt: Date }) => ({
  id: r.id,
  currencyCode: r.currencyCode,
  allPerUnit: rateText(r.allPerUnit),
  effectiveAt: r.effectiveAt,
  createdAt: r.createdAt,
});

/** Current rate per currency: the latest entry effective at or before `at`. */
export async function currentRates(p: Principal, at = new Date()) {
  assertPermission(p, "exchangeRates.view");
  const db = getDb();
  const current = await Promise.all(
    FOREIGN_CURRENCIES.map(async (code) => {
      const r = await db.exchangeRate.findFirst({ where: { currencyCode: code, effectiveAt: { lte: at } }, orderBy: { effectiveAt: "desc" } });
      return { currencyCode: code, rate: r ? toRate(r) : null };
    }),
  );
  return [{ currencyCode: "ALL", rate: { allPerUnit: "1", fixed: true } }, ...current];
}

export async function listRates(p: Principal, query: z.output<typeof rateListQuery>) {
  assertPermission(p, "exchangeRates.view");
  const db = getDb();
  const where = { currencyCode: query.currency ? query.currency : { in: [...FOREIGN_CURRENCIES] } };
  const [rows, total, current] = await Promise.all([
    db.exchangeRate.findMany({ where, orderBy: [{ [query.sort]: query.dir }, { currencyCode: "asc" }], ...skipTake(query.page, query.pageSize) }),
    db.exchangeRate.count({ where }),
    currentRates(p),
  ]);
  return { ...paged(rows.map(toRate), total, query.page, query.pageSize), current };
}

export async function createRate(p: Principal, raw: unknown) {
  assertPermission(p, "exchangeRates.manage");
  const input = exchangeRateSchema.parse(raw);
  try {
    return toRate(await getDb().exchangeRate.create({ data: input }));
  } catch (e) {
    throw mapDatabaseError(e);
  }
}

export const applicableRateQuery = z.object({
  currency: z.enum(["ALL", ...FOREIGN_CURRENCIES]),
  date: z.iso.date(),
});

/**
 * The rate an order dated `date` would use (the same lookup the order pricing
 * service performs). `rate` is null when none is in effect, with the reason.
 */
export async function rateForOrderDate(p: Principal, query: z.output<typeof applicableRateQuery>) {
  assertPermission(p, "exchangeRates.view");
  const day = new Date(query.date + "T00:00:00Z");
  const r = await applicableRate(getDb(), query.currency, day);
  if (!r) return { currencyCode: query.currency, rate: null, message: noRateError(query.currency, day).message };
  return { currencyCode: query.currency, rate: { allPerUnit: rateText(r.allPerUnit), effectiveAt: r.effectiveAt }, message: null };
}
