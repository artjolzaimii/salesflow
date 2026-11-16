"use client";

import { useMemo } from "react";
import { paymentStatus } from "@/lib/money";
import { ROLES, type RoleConfig } from "@/lib/roles";
import type { Customer, DataState, Employee, InvoiceView, Order, Payment, Role } from "@/lib/types";
import { PREVIEW_REP_ID } from "@/mocks/fixtures";
import { usePreview } from "./preview-store";

export function useRole(): RoleConfig & { key: Role } {
  const role = usePreview((s) => s.role);
  return useMemo(() => ({ ...ROLES[role], key: role }), [role]);
}

export interface ScopedData {
  customers: Customer[];
  customerById: Record<string, Customer>;
  orders: Order[];
  invoices: InvoiceView[];
  payments: Payment[];
  employees: Employee[];
  repName: (id: string) => string;
}

/**
 * The records the current role may see. Mirrors the server-side scoping the
 * production API applies: a representative only sees assigned customers and the
 * orders, invoices and payments that belong to them.
 */
export function useScopedData(): ScopedData {
  const data = usePreview((s) => s.data);
  const role = usePreview((s) => s.role);
  const today = usePreview((s) => s.today);

  return useMemo(() => {
    const customerById: Record<string, Customer> = {};
    data.customers.forEach((c) => (customerById[c.id] = c));
    const customers = data.customers.filter((c) => !ROLES[role].scopedToOwnCustomers || c.repId === PREVIEW_REP_ID);
    const ids = new Set(customers.map((c) => c.id));
    const invoices = data.invoices
      .filter((i) => ids.has(i.customerId))
      .map((i) => ({ ...i, outstanding: i.total - i.paid, status: paymentStatus(i, today) }));
    return {
      customers,
      customerById,
      orders: data.orders.filter((o) => ids.has(o.customerId)),
      invoices,
      payments: data.payments.filter((p) => ids.has(p.customerId)),
      employees: data.employees,
      repName: (id: string) => data.employees.find((e) => e.id === id)?.name ?? "—",
    };
  }, [data, role, today]);
}

/** Loading / error / empty / ready flags for list screens, driven by the preview data-state control. */
export interface ListState<T> {
  rows: T[];
  loading: boolean;
  error: boolean;
  empty: boolean;
  show: boolean;
  emptyTitle: string;
  emptyBody: string;
  showClear: boolean;
  errorBody: string;
  endpoint: string;
}

export function listState<T>(dataState: DataState, rows: T[], noun: string, endpoint: string): ListState<T> {
  const ready = dataState === "ready";
  const isEmpty = dataState === "empty";
  return {
    rows: ready ? rows : [],
    loading: dataState === "loading",
    error: dataState === "error",
    show: ready && rows.length > 0,
    empty: isEmpty || (ready && rows.length === 0),
    emptyTitle: isEmpty ? `No ${noun} yet` : `No ${noun} match these filters`,
    emptyBody: isEmpty ? `Records appear here once ${endpoint} returns them.` : "Adjust or clear the filters to widen the results.",
    showClear: !isEmpty,
    errorBody: `Could not load ${noun}. ${endpoint} returned 503 Service Unavailable.`,
    endpoint,
  };
}
