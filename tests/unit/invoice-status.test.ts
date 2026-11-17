import { describe, expect, it } from "vitest";
import { amountCents, amountError } from "@/lib/amount-input";
import { invoiceBadges } from "@/lib/invoice-status";
import { deriveInvoiceStatus } from "@/server/domain/invoice-status";
import { D } from "@/server/domain/money";

const TODAY = "2026-11-17";
const inv = (total: string, dueDate: string, status: "ISSUED" | "CANCELLED" = "ISSUED") => ({ status, total: D(total), dueDate: new Date(dueDate + "T00:00:00Z") });

describe("derived invoice status", () => {
  it("unpaid, partially paid and paid", () => {
    expect(deriveInvoiceStatus(inv("100.00", "2026-12-01"), D(0), TODAY)).toMatchObject({ paymentStatus: "UNPAID", overdue: false });
    const partial = deriveInvoiceStatus(inv("100.00", "2026-12-01"), D("40.00"), TODAY);
    expect(partial).toMatchObject({ paymentStatus: "PARTIALLY_PAID", overdue: false });
    expect(partial.outstanding.toFixed(2)).toBe("60.00");
    const paid = deriveInvoiceStatus(inv("100.00", "2026-01-01"), D("100.00"), TODAY);
    expect(paid).toMatchObject({ paymentStatus: "PAID", overdue: false, daysOverdue: 0 }); // paid is never overdue
    expect(paid.outstanding.toFixed(2)).toBe("0.00");
  });

  it("overdue is a separate flag, so partial + overdue keeps both", () => {
    const s = deriveInvoiceStatus(inv("100.00", "2026-11-07"), D("0.01"), TODAY);
    expect(s).toMatchObject({ paymentStatus: "PARTIALLY_PAID", overdue: true, daysOverdue: 10 });
    expect(invoiceBadges(s)).toEqual(["Overdue", "Partial"]);
    expect(invoiceBadges(deriveInvoiceStatus(inv("100.00", "2026-11-07"), D(0), TODAY))).toEqual(["Overdue"]);
  });

  it("due today is not overdue; one day later is", () => {
    expect(deriveInvoiceStatus(inv("5.00", TODAY), D(0), TODAY).overdue).toBe(false);
    expect(deriveInvoiceStatus(inv("5.00", "2026-11-16"), D(0), TODAY)).toMatchObject({ overdue: true, daysOverdue: 1 });
  });

  it("cancelled invoices owe nothing and are never overdue", () => {
    const s = deriveInvoiceStatus(inv("100.00", "2026-01-01", "CANCELLED"), D(0), TODAY);
    expect(s).toMatchObject({ paymentStatus: "CANCELLED", overdue: false });
    expect(s.outstanding.toFixed(2)).toBe("0.00");
    expect(invoiceBadges(s)).toEqual(["Cancelled"]);
  });

  it("a zero-total invoice counts as paid", () => {
    expect(deriveInvoiceStatus(inv("0.00", "2026-01-01"), D(0), TODAY)).toMatchObject({ paymentStatus: "PAID", overdue: false });
  });
});

describe("payment amount input (browser feedback)", () => {
  it("parses exact cents without floating point", () => {
    expect(amountCents("0.1")).toBe(BigInt(10));
    expect(amountCents("1234.56")).toBe(BigInt(123456));
    expect(amountCents("1.005")).toBeNull();
    expect(amountCents("1e3")).toBeNull();
    expect(amountCents("-5")).toBeNull();
  });

  it("explains precision, zero and overpayment", () => {
    expect(amountError("10.005", "100.00", "EUR")).toMatch(/two decimal places/);
    expect(amountError("0", "100.00", "EUR")).toMatch(/greater than zero/);
    expect(amountError("100.01", "100.00", "EUR")).toBe("Exceeds the outstanding balance of 100.00 EUR.");
    expect(amountError("100.00", "100.00", "EUR")).toBe("");
    expect(amountError("", "100.00", "EUR")).toBe("");
  });
});
