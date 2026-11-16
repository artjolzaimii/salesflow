import type { Role } from "./types";
import type { PageKey } from "./navigation";

/**
 * Preview role configuration (prototype `RC`).
 *
 * In production the session (GET /api/auth/session) returns the role, and this
 * table only decides what the UI shows. The server enforces permissions on
 * every route; hiding a button is never the access control.
 */
export interface RoleConfig {
  user: string;
  title: string;
  initials: string;
  /** Top-level sections visible in the sidebar. */
  nav: PageKey[];
  canCreateOrders: boolean;
  canRegisterPayments: boolean;
  canEditProducts: boolean;
  canCreateCustomers: boolean;
  canIssueInvoices: boolean;
  /** Reps only see their assigned customers and everything derived from them. */
  scopedToOwnCustomers: boolean;
}

export const ROLES: Record<Role, RoleConfig> = {
  rep: {
    user: "Arben Hoxha",
    title: "Sales representative",
    initials: "AH",
    nav: ["dashboard", "orders", "invoices", "payments", "customers", "products", "reports", "assistant"],
    canCreateOrders: true,
    canRegisterPayments: false,
    canEditProducts: false,
    canCreateCustomers: true,
    canIssueInvoices: false,
    scopedToOwnCustomers: true,
  },
  manager: {
    user: "Valbona Gjoka",
    title: "Sales manager",
    initials: "VG",
    nav: ["dashboard", "orders", "invoices", "payments", "customers", "products", "categories", "employees", "reports", "assistant"],
    canCreateOrders: true,
    canRegisterPayments: true,
    canEditProducts: true,
    canCreateCustomers: true,
    canIssueInvoices: true,
    scopedToOwnCustomers: false,
  },
  accountant: {
    user: "Ilir Murati",
    title: "Accountant",
    initials: "IM",
    nav: ["dashboard", "orders", "invoices", "payments", "customers", "reports", "assistant"],
    canCreateOrders: false,
    canRegisterPayments: true,
    canEditProducts: false,
    canCreateCustomers: false,
    canIssueInvoices: true,
    scopedToOwnCustomers: false,
  },
  admin: {
    user: "Sokol Prifti",
    title: "Administrator",
    initials: "SP",
    nav: ["dashboard", "orders", "invoices", "payments", "customers", "products", "categories", "employees", "reports", "assistant", "users", "settings"],
    canCreateOrders: true,
    canRegisterPayments: true,
    canEditProducts: true,
    canCreateCustomers: true,
    canIssueInvoices: true,
    scopedToOwnCustomers: false,
  },
};

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "rep", label: "Sales representative" },
  { value: "manager", label: "Sales manager" },
  { value: "accountant", label: "Accountant" },
  { value: "admin", label: "Administrator" },
];
