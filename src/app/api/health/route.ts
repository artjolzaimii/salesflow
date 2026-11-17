import { connection, NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { logError } from "@/server/log";

/**
 * GET /api/health — liveness and database readiness for a load balancer or
 * uptime monitor. Public by design, so it reveals nothing: no version, no
 * hostnames, no error details. 200 { status: "ok" } or 503 { status: "unavailable" }.
 */
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  try {
    await Promise.race([
      getDb().$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database health check timed out")), 3000)),
    ]);
    return NextResponse.json({ status: "ok" }, { headers });
  } catch (e) {
    logError("health", e);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
