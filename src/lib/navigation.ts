import type { IconName } from "@/components/ui/icon";
import type { RoleConfig } from "./roles";

export type SectionKey =
  | "dashboard"
  | "orders"
  | "invoices"
  | "payments"
  | "customers"
  | "products"
  | "categories"
  | "employees"
  | "reports"
  | "assistant"
  | "users"
  | "settings";

export type PageKey = SectionKey | "newOrder" | "editOrder" | "customerNew" | "customerDetail" | "account";

export const SECTION_HREF: Record<SectionKey, string> = {
  dashboard: "/dashboard",
  orders: "/orders",
  invoices: "/invoices",
  payments: "/payments",
  customers: "/customers",
  products: "/products",
  categories: "/categories",
  employees: "/employees",
  reports: "/reports",
  assistant: "/assistant",
  users: "/users",
  settings: "/settings",
};

export const ROUTES = {
  ...SECTION_HREF,
  newOrder: "/orders/new",
  editOrder: (id: string) => `/orders/${encodeURIComponent(id)}/edit`,
  customerNew: "/customers/new",
  account: "/account",
  customer: (id: string) => `/customers/${encodeURIComponent(id)}`,
  login: "/login",
};

export interface NavItem {
  key: SectionKey;
  label: string;
  icon: IconName;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Overview", items: [{ key: "dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    label: "Sales",
    items: [
      { key: "orders", label: "Orders", icon: "orders" },
      { key: "invoices", label: "Invoices", icon: "invoices" },
      { key: "payments", label: "Payments", icon: "payments" },
    ],
  },
  {
    label: "Management",
    items: [
      { key: "customers", label: "Customers", icon: "customers" },
      { key: "products", label: "Products", icon: "products" },
      { key: "categories", label: "Categories", icon: "categories" },
      { key: "employees", label: "Employees", icon: "employees" },
    ],
  },
  { label: "Analytics", items: [{ key: "reports", label: "Reports", icon: "reports" }] },
  { label: "Intelligence", items: [{ key: "assistant", label: "AI Assistant", icon: "assistant" }] },
  {
    label: "Administration",
    items: [
      { key: "users", label: "User management", icon: "users" },
      { key: "settings", label: "Settings", icon: "settings" },
    ],
  },
];

/** Resolves a pathname to the prototype page key. */
export function pageFromPath(pathname: string): PageKey {
  const parts = pathname.split("/").filter(Boolean);
  const [first, second] = parts;
  if (first === "orders" && second === "new") return "newOrder";
  if (first === "orders" && second && parts[2] === "edit") return "editOrder";
  if (first === "customers" && second === "new") return "customerNew";
  if (first === "customers" && second) return "customerDetail";
  if (first === "account") return "account";
  if (first && first in SECTION_HREF) return first as SectionKey;
  return "dashboard";
}

/** Sidebar section of a page; the account page belongs to none (it falls back to the dashboard crumb). */
export function sectionOf(page: PageKey): SectionKey {
  if (page === "account") return "dashboard";
  if (page === "newOrder" || page === "editOrder") return "orders";
  if (page === "customerNew" || page === "customerDetail") return "customers";
  return page;
}

/** Mirrors the prototype's page guard: unknown or forbidden pages fall back to the dashboard. */
export function canViewPage(page: PageKey, role: RoleConfig): boolean {
  if (page === "account") return true; // every signed-in user manages their own account
  if (!role.nav.includes(sectionOf(page))) return false;
  if (page === "newOrder" && !role.canCreateOrders) return false;
  if (page === "customerNew" && !role.canCreateCustomers) return false;
  return true;
}

export function breadcrumbTrail(page: PageKey, customerName?: string): string[] {
  const map: Record<PageKey, string[]> = {
    dashboard: ["Overview", "Dashboard"],
    orders: ["Sales", "Orders"],
    newOrder: ["Sales", "Orders", "New order"],
    editOrder: ["Sales", "Orders", "Edit order"],
    invoices: ["Sales", "Invoices"],
    payments: ["Sales", "Payments"],
    customers: ["Management", "Customers"],
    customerNew: ["Management", "Customers", "New customer"],
    customerDetail: ["Management", "Customers", customerName || "Customer"],
    products: ["Management", "Products"],
    categories: ["Management", "Categories"],
    employees: ["Management", "Employees"],
    reports: ["Analytics", "Reports"],
    assistant: ["Intelligence", "AI Assistant"],
    users: ["Administration", "User management"],
    account: ["Account", "Security"],
    settings: ["Administration", "Settings"],
  };
  return map[page];
}
