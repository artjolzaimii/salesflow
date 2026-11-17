import { z } from "zod";

/**
 * List-endpoint conventions shared by every module:
 *   ?page=1&pageSize=25&sort=name&dir=asc&q=text
 * - page is 1-based; pageSize 1–100 (default 25),
 * - sort must be one of the endpoint's allowlisted fields (anything else is a
 *   422, never passed through to the database),
 * - q is trimmed, max 100 chars, matched case-insensitively.
 * Responses: { items, page, pageSize, total, pages }.
 */
export const MAX_PAGE_SIZE = 100;

export function listQuery<S extends readonly [string, ...string[]]>(sortFields: S, defaultSort: S[number], defaultDir: "asc" | "desc" = "asc") {
  return z.object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    sort: z.enum(sortFields).default(defaultSort as never),
    dir: z.enum(["asc", "desc"]).default(defaultDir),
    q: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => v || undefined),
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pages: number;
}

export function paged<T>(items: T[], total: number, page: number, pageSize: number): Page<T> {
  return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export const skipTake = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });

/** Query-string → plain object (repeated keys keep the last value). */
export function searchParamsObject(params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(params.entries());
}

/** "true"/"false" query flags. */
export const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");
