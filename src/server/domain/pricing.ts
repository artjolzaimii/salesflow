import { D, round2, round4, type Decimal, type DecimalValue } from "./money";

/**
 * Approved pricing rules (docs/database-starter-README.md):
 * - Product prices are net ALL. A foreign-currency unit price is
 *   round4(defaultNetAll / allPerUnit), with the rate snapshotted on the order.
 * - Per line: gross = round2(qty × unit); discount = round2(gross × pct / 100);
 *   taxable = gross − discount; VAT = round2(taxable × rate / 100);
 *   total = taxable + VAT. Discounts apply before VAT. HALF_UP throughout.
 * - Order totals are sums of the rounded line components.
 */

export interface LineInput {
  quantity: DecimalValue;
  unitNetPrice: DecimalValue;
  discountPercent: DecimalValue;
  vatRate: DecimalValue;
}

export interface LineAmounts {
  grossNet: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  vatAmount: Decimal;
  lineTotal: Decimal;
}

export interface OrderTotals {
  subtotalNet: Decimal;
  discountTotal: Decimal;
  taxableTotal: Decimal;
  vatTotal: Decimal;
  grandTotal: Decimal;
}

export function unitPriceInCurrency(defaultNetAll: DecimalValue, allPerUnit: DecimalValue): Decimal {
  const rate = D(allPerUnit);
  if (rate.lte(0)) throw new RangeError("Exchange rate must be positive.");
  return round4(D(defaultNetAll).div(rate));
}

export function computeLine(line: LineInput): LineAmounts {
  const discount = D(line.discountPercent);
  if (discount.lt(0) || discount.gt(100)) throw new RangeError("Discount must be between 0 and 100.");
  const grossNet = round2(D(line.quantity).mul(line.unitNetPrice));
  const discountAmount = round2(grossNet.mul(discount).div(100));
  const taxableAmount = grossNet.minus(discountAmount);
  const vatAmount = round2(taxableAmount.mul(line.vatRate).div(100));
  return { grossNet, discountAmount, taxableAmount, vatAmount, lineTotal: taxableAmount.plus(vatAmount) };
}

export function sumTotals(lines: LineAmounts[]): OrderTotals {
  const sum = (k: keyof LineAmounts) => lines.reduce((acc, l) => acc.plus(l[k]), D(0));
  return {
    subtotalNet: sum("grossNet"),
    discountTotal: sum("discountAmount"),
    taxableTotal: sum("taxableAmount"),
    vatTotal: sum("vatAmount"),
    grandTotal: sum("lineTotal"),
  };
}

/** ALL equivalent of a document amount at its stored rate (reporting only). */
export function toAll(amount: DecimalValue, allPerUnit: DecimalValue): Decimal {
  return round2(D(amount).mul(allPerUnit));
}

/** True when a line's unit price differs from the catalogue price converted at the order rate. */
export function isPriceOverride(unitNetPrice: DecimalValue, defaultNetAll: DecimalValue, allPerUnit: DecimalValue): boolean {
  return !D(unitNetPrice).eq(unitPriceInCurrency(defaultNetAll, allPerUnit));
}
