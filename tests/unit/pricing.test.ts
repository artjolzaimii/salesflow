import { describe, expect, it } from "vitest";
import { computeLine, isPriceOverride, sumTotals, toAll, unitPriceInCurrency } from "@/server/domain/pricing";

const s = (o: Record<string, { toFixed: (n: number) => string }>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toFixed(2)]));

describe("pricing (Decimal, HALF_UP, discount before VAT)", () => {
  it("reproduces the seeded EUR order SO-2026-002 exactly", () => {
    const juice = unitPriceInCurrency("150", "100"); // 1.5000 EUR
    const soap = unitPriceInCurrency("120", "100"); // 1.2000 EUR
    const lines = [
      computeLine({ quantity: "30", unitNetPrice: juice, discountPercent: "0", vatRate: "20" }),
      computeLine({ quantity: "10", unitNetPrice: soap, discountPercent: "5", vatRate: "20" }),
    ];
    expect(s({ ...sumTotals(lines) })).toEqual({ subtotalNet: "57.00", discountTotal: "0.60", taxableTotal: "56.40", vatTotal: "11.28", grandTotal: "67.68" });
    expect(toAll("67.68", "100").toFixed(2)).toBe("6768.00");
  });

  it("converts catalogue prices to 4 decimals with HALF_UP", () => {
    expect(unitPriceInCurrency("95", "90").toFixed(4)).toBe("1.0556"); // 1.05555…
    expect(unitPriceInCurrency("50", "90").toFixed(4)).toBe("0.5556");
    expect(() => unitPriceInCurrency("10", "0")).toThrow();
  });

  it("rounds each component half-up where binary floats would round down", () => {
    // 2.675 is 2.67499999… as a float; Decimal keeps it exact and rounds up.
    const l = computeLine({ quantity: "1", unitNetPrice: "2.675", discountPercent: "0", vatRate: "0" });
    expect(l.grossNet.toFixed(2)).toBe("2.68");
    const half = computeLine({ quantity: "1", unitNetPrice: "10", discountPercent: "0.05", vatRate: "0" }); // 0.005 discount
    expect(half.discountAmount.toFixed(2)).toBe("0.01");
  });

  it("applies the discount before VAT", () => {
    const l = computeLine({ quantity: "2", unitNetPrice: "100", discountPercent: "10", vatRate: "20" });
    expect([l.grossNet, l.discountAmount, l.taxableAmount, l.vatAmount, l.lineTotal].map((d) => d.toFixed(2))).toEqual(["200.00", "20.00", "180.00", "36.00", "216.00"]);
  });

  it("keeps line identities exact", () => {
    const l = computeLine({ quantity: "3.333", unitNetPrice: "7.7777", discountPercent: "12.5", vatRate: "6" });
    expect(l.grossNet.minus(l.discountAmount).eq(l.taxableAmount)).toBe(true);
    expect(l.taxableAmount.plus(l.vatAmount).eq(l.lineTotal)).toBe(true);
  });

  it("rejects discounts outside 0–100", () => {
    expect(() => computeLine({ quantity: "1", unitNetPrice: "1", discountPercent: "101", vatRate: "0" })).toThrow();
  });

  it("detects price overrides against the converted catalogue price", () => {
    expect(isPriceOverride("1.0556", "95", "90")).toBe(false);
    expect(isPriceOverride("1.00", "95", "90")).toBe(true);
  });
});
