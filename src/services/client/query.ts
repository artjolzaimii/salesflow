"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiFetch, type ApiError } from "./http";

/**
 * Minimal shared query cache for GET endpoints, keyed by URL.
 * - Components subscribe with useApiQuery(url); one request per URL at a time.
 * - After a mutation, invalidate("/api/products") refetches every cached URL
 *   with that prefix while the old data stays on screen.
 */
interface Entry {
  data?: unknown;
  error?: ApiError;
  loading: boolean;
  version: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function fetchKey(key: string) {
  if (inflight.has(key)) return;
  const prev = cache.get(key);
  cache.set(key, { ...prev, loading: true, version: (prev?.version ?? 0) + 1 });
  emit();
  const p = apiFetch<unknown>(key)
    .then((data) => {
      cache.set(key, { data, loading: false, version: (cache.get(key)?.version ?? 0) + 1 });
    })
    .catch((error: ApiError) => {
      cache.set(key, { ...cache.get(key), error, loading: false, version: (cache.get(key)?.version ?? 0) + 1 });
    })
    .finally(() => {
      inflight.delete(key);
      emit();
    });
  inflight.set(key, p);
}

export function invalidate(prefix: string) {
  for (const key of cache.keys()) if (key.startsWith(prefix)) fetchKey(key);
}

export interface QueryResult<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** True only while there is nothing to show yet (first load or after an error). */
  loading: boolean;
  /** A refetch is running in the background (data still shown). */
  refreshing: boolean;
  refetch: () => void;
}

export function useApiQuery<T>(url: string | null): QueryResult<T> {
  const entry = useSyncExternalStore(
    subscribe,
    () => (url ? cache.get(url) : undefined),
    () => undefined,
  );
  useEffect(() => {
    if (url && !cache.get(url)) fetchKey(url);
  }, [url]);
  const refetch = useCallback(() => {
    if (url) fetchKey(url);
  }, [url]);
  const hasData = entry?.data !== undefined;
  return {
    data: entry?.data as T | undefined,
    error: entry?.loading ? undefined : entry?.error,
    loading: !!url && !hasData && !entry?.error,
    refreshing: !!entry?.loading && hasData,
    refetch,
  };
}
