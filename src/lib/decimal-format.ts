/**
 * Exact formatting of decimal strings from the API ("1234.5000"), without
 * converting to floating point.
 */
export function formatDecimal(value: string, minFraction = 2, maxFraction = 4): string {
  const neg = value.startsWith("-");
  const [int, frac = ""] = value.replace(/^-/, "").split(".");
  let f = frac.slice(0, maxFraction).replace(/0+$/, "");
  if (f.length < minFraction) f = f.padEnd(minFraction, "0");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "−" : "") + grouped + (f ? "." + f : "");
}

/** net × (1 + vat/100), rounded half-up to 2 decimals, using integer arithmetic. */
export function grossWithVat(net: string, vatPercent: string): string | null {
  if (!/^\d+(\.\d{1,4})?$/.test(net.trim()) || !/^\d+$/.test(vatPercent)) return null;
  const [i, f = ""] = net.trim().split(".");
  // net × 10^4 × (100 + vat) = gross in units of 10^-6; cents = that / 10^4, rounded half-up once.
  const scaled = BigInt(i + f.padEnd(4, "0")) * BigInt(100 + Number(vatPercent));
  const cents = (scaled + BigInt(5000)) / BigInt(10000);
  const s = cents.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** "1234567.50" → "1,234,568": a non-negative decimal string rounded half-up to whole units, without floating point. */
export function formatWholeDecimal(value: string): string {
  const neg = value.startsWith("-");
  const [int, frac = ""] = value.replace(/^-/, "").split(".");
  const rounded = (BigInt(int || "0") + (frac[0] && frac[0] >= "5" ? BigInt(1) : BigInt(0))).toString();
  return (neg && rounded !== "0" ? "−" : "") + rounded.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Decimal string → number for chart geometry only (bar heights, shares); never for displayed amounts. */
export const chartValue = (value: string) => Number(value) || 0;
