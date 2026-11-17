import type { RecordRef } from "./tools";

/**
 * Post-answer checks:
 * - unverifiedFigures: money-like amounts (two decimals) in the answer that appear
 *   in none of this question's tool results. The prompt forbids invented figures;
 *   this makes any slip visible to the user instead of trusting the model. A
 *   difference the model calculated is also listed, as "not returned by SalesFlow".
 * - linkedRecords: records returned by the tools whose identifier the answer names,
 *   so the screen can link them.
 */

const AMOUNT = /(?<![\d.])\d{1,3}(?:[,   ]\d{3})+(?:\.\d{2})(?!\d)|(?<![\d.,])\d+\.\d{2}(?!\d)/g;

const normalise = (s: string) => {
  const n = s.replace(/[,   ]/g, "");
  return Number.isFinite(Number(n)) ? Number(n).toFixed(2) : null;
};

export function amountsIn(text: string): string[] {
  return [...new Set((text.match(AMOUNT) ?? []).map(normalise).filter((x): x is string => x !== null))];
}

/** Every decimal number in the tool results, as fixed-2 strings. */
function knownAmounts(toolResults: string[]): Set<string> {
  const out = new Set<string>();
  for (const r of toolResults) {
    for (const m of r.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      const n = Number(m);
      if (Number.isFinite(n)) out.add(Math.abs(n).toFixed(2));
    }
  }
  return out;
}

export function unverifiedFigures(answer: string, toolResults: string[]): string[] {
  const known = knownAmounts(toolResults);
  return amountsIn(answer).filter((a) => !known.has(a));
}

export function linkedRecords(answer: string, records: RecordRef[], max = 12): RecordRef[] {
  const seen = new Set<string>();
  const out: RecordRef[] = [];
  const lower = answer.toLowerCase();
  for (const r of records) {
    const key = r.kind + r.id;
    if (seen.has(key) || !r.label || !lower.includes(r.label.toLowerCase())) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}
