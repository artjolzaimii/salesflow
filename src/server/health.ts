import "server-only";
import { isShuttingDown } from "./lifecycle";

/** Minimal database interface, so the check can be tested with a fake. */
export interface HealthDb {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export type HealthResult = { status: "ok" } | { status: "unavailable" | "shutting_down"; reason: "shutting_down" | "database" | "migrations" };

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`health check timed out after ${ms} ms`)), ms))]);

/**
 * Readiness: not shutting down, the database answers, and no migration is in a
 * failed state (a migration that started but did not finish would leave the
 * schema half-applied). The reason is coarse on purpose: no hostnames, versions
 * or error text leave the server.
 */
export async function checkHealth(db: HealthDb, timeoutMs = 3000): Promise<HealthResult> {
  if (isShuttingDown()) return { status: "shutting_down", reason: "shutting_down" };
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, timeoutMs);
  } catch {
    return { status: "unavailable", reason: "database" };
  }
  try {
    const rows = await withTimeout(
      db.$queryRaw<{ failed: bigint | number }[]>`SELECT COUNT(*) AS failed FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      timeoutMs,
    );
    if (Number(rows[0]?.failed ?? 0) > 0) return { status: "unavailable", reason: "migrations" };
  } catch {
    return { status: "unavailable", reason: "migrations" };
  }
  return { status: "ok" };
}
