import { describe, expect, it } from "vitest";
import { isoDate, positiveAmount } from "@/server/domain/money";

const ok = (v: unknown) => positiveAmount.safeParse(v);

describe("payment amount precision", () => {
  it.each(["10", "10.5", "10.50", "0.01", "9999999999999999.99", 10.5, 125])("accepts %s", (v) => {
    const r = ok(v);
    expect(r.success).toBe(true);
  });

  it("keeps the exact decimal value", () => {
    expect(positiveAmount.parse("1234.56").toFixed(2)).toBe("1234.56");
  });

  it.each([
    ["10.005", "at most two decimal places"],
    ["0.001", "at most two decimal places"],
    [10.005, "at most two decimal places"],
    [0.1 + 0.2, "at most two decimal places"], // 0.30000000000000004 is refused, not rounded
  ])("rejects %s instead of rounding it", (v, msg) => {
    const r = ok(v);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toContain(msg);
  });

  it.each(["0", "0.00", "-1", "1e3", "abc", "", " ", "01.5", "1,5", Number.NaN, Infinity, "12345678901234567"])("rejects %s", (v) => {
    expect(ok(v).success).toBe(false);
  });
});

describe("calendar dates", () => {
  it("parses YYYY-MM-DD as UTC midnight", () => {
    expect(isoDate.parse("2026-11-17").toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });
  it.each(["2026-02-30", "17.11.2026", "2026-11-17T10:00:00Z"])("rejects %s", (v) => {
    expect(isoDate.safeParse(v).success).toBe(false);
  });
});
