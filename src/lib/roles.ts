import { can, isScopedRole, type Permission, type UserRole } from "./permissions";
import type { SectionKey } from "./navigation";
import type { ClientSessionUser } from "./session-user";

/**
 * What the UI shows for the signed-in role. Derived from the permission matrix
 * (src/lib/permissions.ts), which the server enforces on every request; these
 * flags only decide which buttons and sections appear.
 */
export interface RoleConfig {
  user: string;
  title: string;
  initials: string;
  /** Top-level sections visible in the sidebar. */
  nav: SectionKey[];
  canCreateOrders: boolean;
  canRegisterPayments: boolean;
  canEditProducts: boolean;
  canCreateCustomers: boolean;
  canIssueInvoices: boolean;
  canCancelInvoices: boolean;
  canFulfilOrders: boolean;
  canCancelOrders: boolean;
  canOverridePrices: boolean;
  canAssignCustomers: boolean;
  canManageCategories: boolean;
  canManageEmployees: boolean;
  canCreateLogins: boolean;
  canManageRates: boolean;
  /** Reps only see their assigned customers and everything derived from them. */
  scopedToOwnCustomers: boolean;
}

/** Permission required to open each section; the server pages check the same table. */
export const SECTION_PERMISSION: Record<SectionKey, Permission> = {
  dashboard: "orders.view",
  orders: "orders.view",
  invoices: "invoices.view",
  payments: "payments.view",
  customers: "customers.view",
  products: "products.view",
  categories: "categories.manage",
  employees: "employees.view",
  reports: "reports.view",
  assistant: "assistant.use",
  users: "users.manage",
  // Settings hosts exchange-rate management (managers and admins).
  settings: "exchangeRates.manage",
};

const SECTION_ORDER = Object.keys(SECTION_PERMISSION) as SectionKey[];

export function roleConfig(user: Pick<ClientSessionUser, "name" | "title" | "initials" | "role">): RoleConfig {
  const role: UserRole = user.role;
  return {
    user: user.name,
    title: user.title,
    initials: user.initials,
    nav: SECTION_ORDER.filter((s) => can(role, SECTION_PERMISSION[s])),
    canCreateOrders: can(role, "orders.create"),
    canRegisterPayments: can(role, "payments.record"),
    canEditProducts: can(role, "products.manage"),
    canCreateCustomers: can(role, "customers.create"),
    canIssueInvoices: can(role, "invoices.issue"),
    canCancelInvoices: can(role, "invoices.cancel"),
    canFulfilOrders: can(role, "orders.fulfil"),
    canCancelOrders: can(role, "orders.cancel"),
    canOverridePrices: can(role, "prices.override"),
    canAssignCustomers: can(role, "customers.assign"),
    canManageCategories: can(role, "categories.manage"),
    canManageEmployees: can(role, "employees.manage"),
    canCreateLogins: can(role, "users.manage"),
    canManageRates: can(role, "exchangeRates.manage"),
    scopedToOwnCustomers: isScopedRole(role),
  };
}
