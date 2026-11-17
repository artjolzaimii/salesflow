import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/auth";
import { clientIp, consume, isLimited } from "@/server/rate-limit";
import { logEvent } from "@/server/log";

export const { GET } = handlers;

/**
 * Auth.js POST endpoints, with a shared per-IP limit on FAILED credential
 * sign-ins (on top of the per-email and per-user MFA throttles). Successful
 * sign-ins and "MFA code required" answers don't count. The limit applies only
 * when CLIENT_IP_HEADER names the trusted proxy's header.
 */
export async function POST(req: NextRequest) {
  const ip = req.nextUrl.pathname.endsWith("/callback/credentials") ? clientIp(req.headers) : null;
  if (ip) {
    const r = await isLimited("signin", ip);
    if (!r.ok) {
      logEvent("signin_rate_limited", { via: "api" }, "warn");
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many failed sign-in attempts from this network. Try again later." } },
        { status: 429, headers: { "Retry-After": String(r.retryAfterSec), "Cache-Control": "no-store" } },
      );
    }
  }
  const res = await handlers.POST(req);
  if (ip && signInFailed(res)) await consume("signin", ip);
  return res;
}

/** Auth.js answers a failed credentials sign-in with a redirect carrying ?error=… (code=mfa_required is not a failure). */
function signInFailed(res: Response): boolean {
  const location = res.headers.get("location");
  if (!location) return false;
  const params = new URL(location, "http://local").searchParams;
  return params.has("error") && params.get("code") !== "mfa_required";
}
