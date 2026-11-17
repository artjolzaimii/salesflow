"use client";

/** Error body every API route returns: { error: { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[] | string>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** First message per field, for forms (keys as the API reports them, e.g. "contacts.0.phone"). */
  fieldMessages(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details ?? {})) out[k] = Array.isArray(v) ? v[0] : v;
    return out;
  }
}

/**
 * Same-origin JSON fetch for the business APIs. The session cookie travels
 * automatically; a 401 means the session ended, so the user is sent to sign in.
 */
export async function apiFetch<T>(path: string, init: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  // Session ended: a full page load (not client navigation) so no signed-in state survives.
  if (res.status === 401 && typeof window !== "undefined") window.location.assign(new URL("/login", window.location.origin).href);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message ?? "The request failed.", e.details);
  }
  return data as T;
}

/** Query string from defined, non-empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== "all") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Human message for an error, with the HTTP meaning for the common cases. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return "You don't have permission to do this.";
    if (e.status === 404) return "This record doesn't exist or isn't assigned to you.";
    return e.message;
  }
  return "Could not reach the server. Check your connection and try again.";
}
