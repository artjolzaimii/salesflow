/**
 * Browser-side order estimate while the user types. It follows the server's
 * pricing steps with exact fixed-point integers (no floating point), but it is
 * only a preview: the server (src/server/services/order-pricing.ts) prices
 * every saved order itself and its figures are authoritative.
 */

const SCALE = 12;
const ONE = BigInt(10) ** BigInt(SCALE);
const pow = (n: number) => BigInt(10) ** BigInt(n);

/** Non-negative decimal text → fixed-point bigint, or null if not a plain decimal. */
export function parseFixed(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  if (f.length > SCALE) return null;
  return BigInt(i) * ONE + BigInt(f.padEnd(SCALE, "0") || "0");
}

/** Half-up rounding (values are non-negative) to `dp` decimals, kept at full scale. */
function round(x: bigint, dp: number): bigint {
  const f = pow(SCALE - dp);
  return ((x + f / BigInt(2)) / f) * f;
}

const mul = (a: bigint, b: bigint) => (a * b) / ONE;
const div = (a: bigint, b: bigint) => (a * ONE) / b;

export function formatFixed(x: bigint, dp: number): string {
  const r = round(x, dp) / pow(SCALE - dp);
  const s = r.toString().padStart(dp + 1, "0");
  return dp ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s;
}

/** round4(netAll / rate): the catalogue unit price in the order currency. */
export function catalogueUnitPrice(netAll: string, rate: string): string | null {
  const n = parseFixed(netAll);
  const r = parseFixed(rate);
  if (n === null || r === null || r === BigInt(0)) return null;
  return formatFixed(div(n, r), 4);
}

export interface EstimateLine {
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatRate: string;
}

export interface EstimateAmounts {
  grossNet: bigint;
  discountAmount: bigint;
  taxableAmount: bigint;
  vatAmount: bigint;
  lineTotal: bigint;
}

/** One line, or null while any input is not a valid number yet. */
export function estimateLine(l: EstimateLine): EstimateAmounts | null {
  const q = parseFixed(l.quantity);
  const p = parseFixed(l.unitPrice);
  const d = parseFixed(l.discountPercent || "0");
  const v = parseFixed(l.vatRate);
  if (q === null || p === null || d === null || v === null || d > BigInt(100) * ONE) return null;
  const hundred = BigInt(100) * ONE;
  const grossNet = round(mul(q, p), 2);
  const discountAmount = round(div(mul(grossNet, d), hundred), 2);
  const taxableAmount = grossNet - discountAmount;
  const vatAmount = round(div(mul(taxableAmount, v), hundred), 2);
  return { grossNet, discountAmount, taxableAmount, vatAmount, lineTotal: taxableAmount + vatAmount };
}

export interface EstimateTotals {
  subtotalNet: string;
  discountTotal: string;
  taxableTotal: string;
  vatTotal: string;
  grandTotal: string;
}

export function estimateTotals(lines: (EstimateAmounts | null)[]): EstimateTotals {
  const sum = (k: keyof EstimateAmounts) => lines.reduce((a, l) => a + (l ? l[k] : BigInt(0)), BigInt(0));
  return {
    subtotalNet: formatFixed(sum("grossNet"), 2),
    discountTotal: formatFixed(sum("discountAmount"), 2),
    taxableTotal: formatFixed(sum("taxableAmount"), 2),
    vatTotal: formatFixed(sum("vatAmount"), 2),
    grandTotal: formatFixed(sum("lineTotal"), 2),
  };
}

/** round2(amount × rate): ALL equivalent at the order rate. */
export function toAllEstimate(amount: string, rate: string): string | null {
  const a = parseFixed(amount);
  const r = parseFixed(rate);
  return a === null || r === null ? null : formatFixed(mul(a, r), 2);
}
