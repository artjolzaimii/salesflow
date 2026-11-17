import "server-only";
import { assertPermission, type Principal } from "@/server/auth/principal";
import { getDb } from "@/server/db";
import { isShuttingDown } from "@/server/lifecycle";

/**
 * Operational summary for administrators (monitoring without a separate tool):
 * database latency and migrations, sign-in and lockout activity, assistant
 * usage and estimated spend, security events. Counts only: no emails, tokens,
 * questions or amounts.
 */
export async function opsSummary(p: Principal) {
  assertPermission(p, "users.manage");
  const db = getDb();
  const t0 = performance.now();
  await db.$queryRaw`SELECT 1`;
  const dbLatencyMs = Math.round(performance.now() - t0);
  const day = new Date(Date.now() - 24 * 3600_000);
  const hour = new Date(Date.now() - 3600_000);
  const [migrations, sessions24h, activeSessions, locked, rateLimited, assistant, securityEvents, connections] = await Promise.all([
    db.$queryRaw<{ applied: bigint; failed: bigint; latest: string | null; latest_at: Date | null }[]>`
      SELECT COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
             COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed,
             MAX(migration_name) AS latest, MAX(finished_at) AS latest_at
      FROM _prisma_migrations`,
    db.authSession.count({ where: { createdAt: { gte: day } } }),
    db.authSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    db.authLoginThrottle.count({ where: { lockedUntil: { gt: new Date() } } }),
    db.rateLimitCounter.count({ where: { windowStart: { gte: hour } } }),
    db.$queryRaw<{ questions: bigint; errors: bigint; spend: number | null }[]>`
      SELECT COUNT(*) FILTER (WHERE role = 'USER') AS questions,
             COUNT(*) FILTER (WHERE role = 'ASSISTANT' AND tool_metadata->>'status' = 'error') AS errors,
             SUM((tool_metadata->>'estimatedCostUsd')::numeric) FILTER (WHERE role = 'ASSISTANT')::float8 AS spend
      FROM ai_messages WHERE created_at > ${day}`,
    db.securityAuditEvent.count({ where: { createdAt: { gte: day } } }),
    db.$queryRaw<{ total: bigint; max: number }[]>`
      SELECT (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS total,
             current_setting('max_connections')::int AS max`,
  ]);
  const m = migrations[0];
  return {
    generatedAt: new Date(),
    instance: { shuttingDown: isShuttingDown(), uptimeSec: Math.round(process.uptime()), node: process.version },
    database: {
      latencyMs: dbLatencyMs,
      connections: Number(connections[0]?.total ?? 0),
      maxConnections: Number(connections[0]?.max ?? 0),
      poolMaxPerInstance: Number(process.env.DATABASE_POOL_MAX ?? 10),
      migrations: { applied: Number(m?.applied ?? 0), failed: Number(m?.failed ?? 0), latest: m?.latest ?? null, latestAt: m?.latest_at ?? null },
    },
    auth: { signInsLast24h: sessions24h, activeSessions, lockedSignInKeys: locked, rateLimitBucketsLastHour: rateLimited },
    assistant: {
      questionsLast24h: Number(assistant[0]?.questions ?? 0),
      errorsLast24h: Number(assistant[0]?.errors ?? 0),
      estimatedSpendUsdLast24h: Math.round((assistant[0]?.spend ?? 0) * 10_000) / 10_000,
      dailyCapUsd: Number(process.env.ASSISTANT_DAILY_USD_TOTAL ?? 50),
    },
    securityEventsLast24h: securityEvents,
  };
}
