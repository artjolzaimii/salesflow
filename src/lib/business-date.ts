/** The business operates in Albania: "today" and order dates are Europe/Tirane calendar dates. */
export const BUSINESS_TIME_ZONE = "Europe/Tirane";

/** YYYY-MM-DD for `at` in the business time zone. */
export function businessDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "2026-11-17" → Date at 00:00 UTC (how DATE-like values are stored). */
export const utcDate = (ymd: string) => new Date(ymd + "T00:00:00Z");

/** Date → "YYYY-MM-DD" using its UTC calendar day. */
export const ymd = (d: Date | string) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
