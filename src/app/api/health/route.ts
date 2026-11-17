import { connection, NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { checkHealth } from "@/server/health";
import { logEvent } from "@/server/log";

/**
 * GET /api/health — readiness for a load balancer or uptime monitor. Public by
 * design, so it reveals nothing beyond a coarse reason: 200 { status: "ok" },
 * or 503 { status: "unavailable" | "shutting_down", reason }.
 */
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  const result = await checkHealth(getDb());
  if (result.status === "ok") return NextResponse.json(result, { headers });
  if (result.status !== "shutting_down") logEvent("health_failed", { reason: result.reason }, "warn");
  return NextResponse.json(result, { status: 503, headers });
}
