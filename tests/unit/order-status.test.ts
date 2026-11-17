import { describe, expect, it } from "vitest";
import { canTransition, ORDER_STATUSES, ORDER_TRANSITIONS } from "@/lib/order-status";

describe("order lifecycle table", () => {
  it("allows the forward path and cancellation before delivery", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "DELIVERED")).toBe(true);
    for (const s of ["DRAFT", "CONFIRMED", "PROCESSING"] as const) expect(canTransition(s, "CANCELLED")).toBe(true);
  });

  it("never goes backwards or out of a terminal state", () => {
    expect(canTransition("PROCESSING", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "DRAFT")).toBe(false);
    expect(canTransition("DRAFT", "DELIVERED")).toBe(false);
    for (const to of ORDER_STATUSES) {
      expect(canTransition("DELIVERED", to)).toBe(false);
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
  });

  it("has no Invoiced status", () => {
    expect(Object.keys(ORDER_TRANSITIONS)).not.toContain("INVOICED");
  });
});
