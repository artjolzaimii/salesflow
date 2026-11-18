import { describe, expect, it } from "vitest";
import { mapDatabaseError } from "@/server/errors";
import { db } from "../support/fixtures";

/** Foreign-key failures are reported for what actually happened (deployment fix, 2026-11-18). */
describe("foreign-key errors", () => {
  it("a write that points at a missing record is not reported as 'cannot be removed'", async () => {
    const customer = await db().customer.findFirstOrThrow({ select: { id: true } });
    const rep = await db().employee.findFirstOrThrow({ select: { id: true } });
    const e = await db()
      .order.create({
        data: { orderNumber: `FK-${crypto.randomUUID().slice(0, 8)}`, customerId: customer.id, salesRepId: rep.id, currencyCode: "XXX", allPerUnit: "1", orderDate: new Date(), subtotalNet: "0", discountTotal: "0", taxableTotal: "0", vatTotal: "0", grandTotal: "0" },
      })
      .catch((err: unknown) => err);
    expect(mapDatabaseError(e)).toMatchObject({ status: 409, code: "REFERENCE_NOT_FOUND" });
  });

  it("deleting a record that is still referenced keeps the IN_USE answer", async () => {
    const e = await db().currency.delete({ where: { code: "ALL" } }).catch((err: unknown) => err);
    expect(mapDatabaseError(e)).toMatchObject({ status: 409, code: "IN_USE" });
  });

  it("the reference currencies exist (created by migration, not only by the seed)", async () => {
    const codes = (await db().currency.findMany({ select: { code: true }, orderBy: { code: "asc" } })).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(["ALL", "EUR", "USD"]));
  });
});
