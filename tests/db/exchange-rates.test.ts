import { describe, expect, it } from "vitest";
import { createRate, currentRates, listRates, rateListQuery } from "@/server/services/exchange-rates";
import { db, errorCode, invalidFields, MANAGER, principalFor, REP_TIRANA } from "../support/fixtures";

let day = 0;
/** A distinct past date per call so tests never collide on (currency, effectiveAt). */
const pastDate = () => new Date(Date.UTC(2025, 0, 1) + ++day * 86_400_000).toISOString().slice(0, 10);

describe("exchange rates", () => {
  it("records manual rates as '1 unit = X ALL' and serves the latest effective one", async () => {
    const m = await principalFor(MANAGER);
    const r = await createRate(m, { currencyCode: "EUR", allPerUnit: "97.8", effectiveAt: "2026-11-16" });
    expect(r).toMatchObject({ currencyCode: "EUR", allPerUnit: "97.80" });
    const later = await createRate(m, { currencyCode: "EUR", allPerUnit: "97.12345678", effectiveAt: "2026-11-17T06:00:00Z" });
    expect(later.allPerUnit).toBe("97.12345678");
    await createRate(m, { currencyCode: "EUR", allPerUnit: "200", effectiveAt: "2099-01-01" }); // future-dated: not current yet
    const current = await currentRates(m, new Date("2026-11-17T12:00:00Z"));
    expect(current.find((c) => c.currencyCode === "EUR")?.rate?.allPerUnit).toBe("97.12345678");
    expect(current.find((c) => c.currencyCode === "ALL")?.rate?.allPerUnit).toBe("1");
  });

  it("validates currency, value, precision and duplicates", async () => {
    const m = await principalFor(MANAGER);
    expect(await invalidFields(createRate(m, { currencyCode: "ALL", allPerUnit: "1", effectiveAt: pastDate() }))).toEqual(["currencyCode"]);
    expect(await invalidFields(createRate(m, { currencyCode: "GBP", allPerUnit: "120", effectiveAt: pastDate() }))).toEqual(["currencyCode"]);
    expect(await invalidFields(createRate(m, { currencyCode: "USD", allPerUnit: "0", effectiveAt: pastDate() }))).toEqual(["allPerUnit"]);
    expect(await invalidFields(createRate(m, { currencyCode: "USD", allPerUnit: "-90", effectiveAt: pastDate() }))).toEqual(["allPerUnit"]);
    expect(await invalidFields(createRate(m, { currencyCode: "USD", allPerUnit: "90.123456789", effectiveAt: pastDate() }))).toEqual(["allPerUnit"]);
    expect(await invalidFields(createRate(m, { currencyCode: "USD", allPerUnit: "250000", effectiveAt: pastDate() }))).toEqual(["allPerUnit"]);
    expect(await invalidFields(createRate(m, { currencyCode: "USD", allPerUnit: "90", effectiveAt: "17.11.2026" }))).toEqual(["effectiveAt"]);
    const d = pastDate();
    await createRate(m, { currencyCode: "USD", allPerUnit: "90.5", effectiveAt: d });
    expect(await errorCode(createRate(m, { currencyCode: "USD", allPerUnit: "91", effectiveAt: d }))).toBe("DUPLICATE_RATE");
  });

  it("representatives can read rates but not enter them", async () => {
    const rep = await principalFor(REP_TIRANA);
    expect((await listRates(rep, rateListQuery.parse({ currency: "EUR" }))).items.every((r) => r.currencyCode === "EUR")).toBe(true);
    expect(await errorCode(createRate(rep, { currencyCode: "EUR", allPerUnit: "98", effectiveAt: pastDate() }))).toBe("FORBIDDEN");
  });

  it("new rates never change the rate snapshotted on existing orders and invoices", async () => {
    const m = await principalFor(MANAGER);
    const before = await db().order.findUniqueOrThrow({ where: { orderNumber: "SO-2026-002" }, include: { invoices: true } });
    await createRate(m, { currencyCode: "EUR", allPerUnit: "150", effectiveAt: pastDate() });
    const after = await db().order.findUniqueOrThrow({ where: { orderNumber: "SO-2026-002" }, include: { invoices: true } });
    expect(after.allPerUnit.toFixed(2)).toBe("100.00");
    expect(after.invoices[0].allPerUnit.eq(before.invoices[0].allPerUnit)).toBe(true);
  });
});
