import { describe, expect, it } from "vitest";
import { can, PERMISSIONS, USER_ROLES, type Permission } from "@/lib/permissions";
import { roleConfig } from "@/lib/roles";
import { makeClientUser } from "@/lib/session-user";

const roles = (p: Permission) => USER_ROLES.filter((r) => can(r, p));

describe("permission matrix", () => {
  it("has exactly three roles and no accountant", () => {
    expect(USER_ROLES).toEqual(["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]);
  });

  it.each<[Permission, string[]]>([
    ["users.manage", ["ADMIN"]],
    ["settings.manage", ["ADMIN"]],
    ["employees.manage", ["ADMIN"]],
    ["employees.view", ["ADMIN", "SALES_MANAGER"]],
    ["customers.view", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
    ["customers.create", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
    ["customers.assign", ["ADMIN", "SALES_MANAGER"]],
    ["products.manage", ["ADMIN", "SALES_MANAGER"]],
    ["categories.manage", ["ADMIN", "SALES_MANAGER"]],
    ["orders.create", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
    ["orders.fulfil", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
    ["orders.cancel", ["ADMIN", "SALES_MANAGER"]],
    ["prices.override", ["ADMIN", "SALES_MANAGER"]],
    ["invoices.issue", ["ADMIN", "SALES_MANAGER"]],
    ["invoices.cancel", ["ADMIN", "SALES_MANAGER"]],
    ["payments.record", ["ADMIN", "SALES_MANAGER"]],
    ["reports.view", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
    ["assistant.use", ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"]],
  ])("%s → %j", (permission, expected) => {
    expect(roles(permission)).toEqual(expected);
  });

  it("gives every permission to at least the admin", () => {
    for (const p of Object.keys(PERMISSIONS) as Permission[]) expect(can("ADMIN", p)).toBe(true);
  });

  it("derives UI navigation from the matrix", () => {
    const nav = (role: "ADMIN" | "SALES_MANAGER" | "SALES_REPRESENTATIVE") => roleConfig(makeClientUser({ name: "A B", email: "a@b.c", role })).nav;
    expect(nav("SALES_REPRESENTATIVE")).toEqual(["dashboard", "orders", "invoices", "payments", "customers", "products", "reports", "assistant"]);
    expect(nav("SALES_MANAGER")).toEqual(["dashboard", "orders", "invoices", "payments", "customers", "products", "categories", "employees", "reports", "assistant"]);
    expect(nav("ADMIN")).toContain("users");
    expect(roleConfig(makeClientUser({ name: "R", email: "r@x.y", role: "SALES_REPRESENTATIVE" })).scopedToOwnCustomers).toBe(true);
  });
});
