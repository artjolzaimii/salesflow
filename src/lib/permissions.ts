/**
 * Central permission matrix. The single source of truth for what each role may
 * do; the server enforces it (src/server/auth), and the UI only reads it to
 * decide what to show. Hiding a button is never the access control.
 *
 * Record-level scope is separate from these permissions: a sales representative
 * holding `customers.view` still only sees customers assigned to them, and the
 * orders, invoices and payments that belong to those customers or to orders they
 * sell (see src/server/auth/scope.ts).
 */

export const USER_ROLES = ["ADMIN", "SALES_MANAGER", "SALES_REPRESENTATIVE"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const ALL: readonly UserRole[] = USER_ROLES;
const MANAGEMENT: readonly UserRole[] = ["ADMIN", "SALES_MANAGER"];
const ADMIN_ONLY: readonly UserRole[] = ["ADMIN"];

export const PERMISSIONS = {
  // User administration
  "users.manage": ADMIN_ONLY,
  "settings.manage": ADMIN_ONLY,
  // Employees
  "employees.view": MANAGEMENT,
  "employees.manage": ADMIN_ONLY,
  // Customers (reps: own assigned customers only)
  "customers.view": ALL,
  "customers.create": ALL,
  "customers.update": ALL,
  "customers.assign": MANAGEMENT,
  // Products, categories, exchange rates
  "products.view": ALL,
  "products.manage": MANAGEMENT,
  "categories.manage": MANAGEMENT,
  "exchangeRates.view": ALL,
  "exchangeRates.manage": MANAGEMENT,
  // Orders (reps: orders of their customers or that they sell)
  "orders.view": ALL,
  "orders.create": ALL,
  "orders.update": ALL,
  "orders.fulfil": ALL,
  "orders.cancel": MANAGEMENT,
  "prices.override": MANAGEMENT,
  // Invoices
  "invoices.view": ALL,
  "invoices.issue": MANAGEMENT,
  "invoices.cancel": MANAGEMENT,
  // Payments
  "payments.view": ALL,
  "payments.record": MANAGEMENT,
  // Reporting and AI
  "reports.view": ALL,
  "assistant.use": ALL,
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Roles whose record access is limited to their own customers and orders. */
export function isScopedRole(role: UserRole): boolean {
  return role === "SALES_REPRESENTATIVE";
}

export const ROLE_TITLES: Record<UserRole, string> = {
  ADMIN: "Administrator",
  SALES_MANAGER: "Sales manager",
  SALES_REPRESENTATIVE: "Sales representative",
};
