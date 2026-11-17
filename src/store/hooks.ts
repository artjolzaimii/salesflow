"use client";

import { useMemo } from "react";
import { paymentStatus } from "@/lib/money";
import type { UserRole } from "@/lib/permissions";
import { roleConfig, type RoleConfig } from "@/lib/roles";
import type { Customer, Employee, InvoiceView, Order, Payment } from "@/lib/types";
import { PREVIEW_REP_ID } from "@/mocks/fixtures";
import { usePreview } from "./preview-store";
import { useSessionUser } from "./session";

/** UI flags for the signed-in user's role (from the server session, not a client setting). */
export function useRole(): RoleConfig & { key: UserRole } {
  const user = useSessionUser();
  return useMemo(() => ({ ...roleConfig(user), key: user.role }), [user]);
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
  const scoped = useRole().scopedToOwnCustomers;
  const today = usePreview((s) => s.today);

  return useMemo(() => {
    const customerById: Record<string, Customer> = {};
    data.customers.forEach((c) => (customerById[c.id] = c));
    const customers = data.customers.filter((c) => !scoped || c.repId === PREVIEW_REP_ID);
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
  }, [data, scoped, today]);
}

/** Loading / error / empty / ready flags for list screens. */
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
  /** Live data: refetch. Preview lists fall back to a toast. */
  retry?: () => void;
}

/**
 * List state for screens backed by the real API: loading until the first
 * response, the API's error message with a working Retry, and an empty state
 * that distinguishes "nothing yet" from "no matches for these filters".
 */
export function apiListState<T>(
  q: { loading: boolean; error?: { message: string }; refetch: () => void },
  rows: T[],
  noun: string,
  filtered: boolean,
): ListState<T> {
  const error = !!q.error && !q.loading;
  const ready = !q.loading && !error;
  return {
    rows,
    loading: q.loading,
    error,
    show: ready && rows.length > 0,
    empty: ready && rows.length === 0,
    emptyTitle: filtered ? `No ${noun} match these filters` : `No ${noun} yet`,
    emptyBody: filtered ? "Adjust or clear the filters to widen the results." : `New ${noun} appear here once they are added.`,
    showClear: filtered,
    errorBody: `Could not load ${noun}. ${q.error?.message ?? ""}`.trim(),
    endpoint: "",
    retry: q.refetch,
  };
}
