"use client";

import { useMemo } from "react";
import type { UserRole } from "@/lib/permissions";
import { roleConfig, type RoleConfig } from "@/lib/roles";
import { useSessionUser } from "./session";

/** UI flags for the signed-in user's role (from the server session, not a client setting). */
export function useRole(): RoleConfig & { key: UserRole } {
  const user = useSessionUser();
  return useMemo(() => ({ ...roleConfig(user), key: user.role }), [user]);
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
