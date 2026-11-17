import { describe, expect, it } from "vitest";
import { rangeLabel, resolvePeriod } from "@/lib/report-period";
import { formatWholeDecimal } from "@/lib/decimal-format";

describe("reporting periods (inclusive business dates)", () => {
  it("today, week, month and year end today and compare with the same span before", () => {
    // 2026-11-17 is a Tuesday.
    expect(resolvePeriod("today", "2026-11-17")).toMatchObject({ from: "2026-11-17", to: "2026-11-17", prevFrom: "2026-11-16", prevTo: "2026-11-16", days: 1 });
    expect(resolvePeriod("week", "2026-11-17")).toMatchObject({ from: "2026-11-16", to: "2026-11-17", prevFrom: "2026-11-09", prevTo: "2026-11-10" });
    expect(resolvePeriod("week", "2026-11-22")).toMatchObject({ from: "2026-11-16", to: "2026-11-22" }); // Sunday ends the ISO week
    expect(resolvePeriod("month", "2026-11-17")).toMatchObject({ from: "2026-11-01", prevFrom: "2026-10-01", prevTo: "2026-10-17", label: "1–17 Nov 2026" });
    expect(resolvePeriod("year", "2026-11-17")).toMatchObject({ from: "2026-01-01", prevFrom: "2025-01-01", prevTo: "2025-11-17" });
  });

  it("clamps comparison days to shorter months and leap years", () => {
    expect(resolvePeriod("month", "2026-03-31")).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(resolvePeriod("month", "2026-01-15")).toMatchObject({ prevFrom: "2025-12-01", prevTo: "2025-12-15" });
    expect(resolvePeriod("year", "2028-02-29")).toMatchObject({ prevTo: "2027-02-28" });
  });

  it("custom ranges compare with the equally long range just before", () => {
    expect(resolvePeriod("custom", "2026-11-17", { from: "2024-03-01", to: "2024-03-31" })).toMatchObject({ days: 31, prevFrom: "2024-01-30", prevTo: "2024-02-29" });
  });

  it("labels ranges compactly", () => {
    expect(rangeLabel("2026-11-17", "2026-11-17")).toBe("17 Nov 2026");
    expect(rangeLabel("2026-10-03", "2026-11-17")).toBe("3 Oct – 17 Nov 2026");
    expect(rangeLabel("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026");
  });
});

describe("whole-unit formatting of decimal strings", () => {
  it("rounds half up without floating point", () => {
    expect(formatWholeDecimal("1234567.50")).toBe("1,234,568");
    expect(formatWholeDecimal("0.49")).toBe("0");
    expect(formatWholeDecimal("99999999999999.50")).toBe("100,000,000,000,000");
  });
});
