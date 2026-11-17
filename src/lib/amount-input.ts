/**
 * Payment-amount checks for the browser, on exact decimal text (no floating
 * point). The server validates again and its answer is authoritative.
 */
const AMOUNT = /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/;

/** "12.5" → 1250n cents, or null when not a plain amount with at most 2 decimals. */
export function amountCents(text: string): bigint | null {
  const t = text.trim();
  if (!AMOUNT.test(t)) return null;
  const [i, f = ""] = t.split(".");
  return BigInt(i) * BigInt(100) + BigInt(f.padEnd(2, "0"));
}

/** Inline message for an amount against the open balance (both decimal strings), or "". */
export function amountError(text: string, outstanding: string | null, currency: string): string {
  if (text.trim() === "") return "";
  if (/^\d+\.\d{3,}$/.test(text.trim())) return "Use at most two decimal places.";
  const cents = amountCents(text);
  if (cents === null) return "Enter an amount such as 1250.00.";
  if (cents <= BigInt(0)) return "Enter an amount greater than zero.";
  const open = outstanding === null ? null : amountCents(outstanding);
  if (open !== null && cents > open) return `Exceeds the outstanding balance of ${outstanding} ${currency}.`;
  return "";
}
