import { describe, expect, it } from "vitest";
import { formatDecimal, grossWithVat } from "@/lib/decimal-format";

describe("exact decimal display", () => {
  it("formats API decimal strings without float conversion", () => {
    expect(formatDecimal("1234567.5000")).toBe("1,234,567.50");
    expect(formatDecimal("1.0556")).toBe("1.0556");
    expect(formatDecimal("12345678901234.9999")).toBe("12,345,678,901,234.9999");
    expect(formatDecimal("97.80000000", 2, 8)).toBe("97.80");
    expect(formatDecimal("0.0000")).toBe("0.00");
  });

  it("computes the VAT-inclusive hint half-up in one step", () => {
    expect(grossWithVat("100", "20")).toBe("120.00");
    expect(grossWithVat("0.0125", "20")).toBe("0.02"); // 0.015 → 0.02
    expect(grossWithVat("10.0375", "20")).toBe("12.05"); // 12.045 → 12.05
    expect(grossWithVat("1.2345", "6")).toBe("1.31"); // 1.30857
    expect(grossWithVat("abc", "20")).toBeNull();
  });
});
