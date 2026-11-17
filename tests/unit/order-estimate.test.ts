import { describe, expect, it } from "vitest";
import { catalogueUnitPrice, estimateLine, estimateTotals, toAllEstimate } from "@/lib/order-estimate";
import { computeLine, sumTotals, toAll, unitPriceInCurrency } from "@/server/domain/pricing";

/** The browser estimate must agree with the server's pricing rules, so "estimate" and "confirmed" rarely differ. */
describe("browser order estimate", () => {
  it("matches the server pricing on worked examples", () => {
    expect(catalogueUnitPrice("1234.5678", "105.5")).toBe("11.7021");
    expect(catalogueUnitPrice("99.99", "95.25")).toBe("1.0498");
    const a = estimateLine({ quantity: "3", unitPrice: "11.7021", discountPercent: "12.5", vatRate: "20" })!;
    const b = estimateLine({ quantity: "2.5", unitPrice: "0.9478", discountPercent: "0", vatRate: "6" })!;
    expect(estimateTotals([a, b])).toEqual({ subtotalNet: "37.48", discountTotal: "4.39", taxableTotal: "33.09", vatTotal: "6.28", grandTotal: "39.37" });
    expect(toAllEstimate("39.37", "105.5")).toBe("4153.54");
  });

  it("returns null for incomplete or invalid input instead of guessing", () => {
    expect(estimateLine({ quantity: "", unitPrice: "1", discountPercent: "0", vatRate: "20" })).toBeNull();
    expect(estimateLine({ quantity: "1", unitPrice: "abc", discountPercent: "0", vatRate: "20" })).toBeNull();
    expect(estimateLine({ quantity: "1", unitPrice: "1", discountPercent: "101", vatRate: "20" })).toBeNull();
    expect(catalogueUnitPrice("10", "0")).toBeNull();
  });

  it("agrees with the server on 2,000 pseudo-random lines (HALF_UP at every step)", () => {
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    const dec = (int: number, dp: number) => `${rnd(int)}${dp ? "." + String(rnd(10 ** dp)).padStart(dp, "0") : ""}`;
    for (let i = 0; i < 2000; i++) {
      const net = dec(100000, 4);
      const rate = `${1 + rnd(200)}.${String(rnd(1e8)).padStart(8, "0")}`;
      const qty = `${1 + rnd(5000)}.${String(rnd(1000)).padStart(3, "0")}`;
      const disc = rnd(4) ? dec(100, 2) : "0";
      const vat = ["20", "10", "6", "0"][rnd(4)];
      const unit = catalogueUnitPrice(net, rate)!;
      expect(unit, `${net}/${rate}`).toBe(unitPriceInCurrency(net, rate).toFixed(4));
      const est = estimateLine({ quantity: qty, unitPrice: unit, discountPercent: disc, vatRate: vat })!;
      const srv = computeLine({ quantity: qty, unitNetPrice: unit, discountPercent: disc, vatRate: vat });
      const t = estimateTotals([est]);
      const s = sumTotals([srv]);
      expect(t).toEqual({
        subtotalNet: s.subtotalNet.toFixed(2),
        discountTotal: s.discountTotal.toFixed(2),
        taxableTotal: s.taxableTotal.toFixed(2),
        vatTotal: s.vatTotal.toFixed(2),
        grandTotal: s.grandTotal.toFixed(2),
      });
      expect(toAllEstimate(t.grandTotal, rate)).toBe(toAll(t.grandTotal, rate).toFixed(2));
    }
  });
});
