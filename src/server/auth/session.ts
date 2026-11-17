import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { auth } from "@/auth";
import type { Permission } from "@/lib/permissions";
import { AppError, unauthenticated } from "@/server/errors";
import { loadPrincipal } from "./load-principal";
import { assertPermission, hasPermission, type Principal } from "./principal";

/**
 * Data Access Layer entry point: the signed-in user for this request, or null.
 *
 * The session cookie only proves who the user was at sign-in. The role and the
 * active flags are re-read here on every request, so a disabled account or a
 * changed role applies immediately. Deduplicated per request with React cache().
 * Deliberately not `use cache: private`: that would keep a disabled user's
 * session valid in the browser cache for minutes.
 */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  // Request-time only: decoding and refreshing the session cookie uses
  // randomness and the clock, which must not run during prerendering.
  await connection();
  const session = await auth();
  const userId = session?.user?.id;
  const sid = (session as { sid?: string } | null)?.sid;
  if (!userId || !sid) return null;
  return loadPrincipal(userId, sid);
});

/* ---------- pages (redirects) ---------- */

export async function requirePageUser(): Promise<Principal> {
  const p = await getPrincipal();
  if (!p) redirect("/login");
  return p;
}

/** A page the role may not open sends the user to the dashboard, as the UI does. */
export async function requirePagePermission(permission: Permission): Promise<Principal> {
  const p = await requirePageUser();
  if (!hasPermission(p, permission)) redirect("/dashboard");
  return p;
}

/* ---------- route handlers and server actions (errors) ---------- */

/**
 * The signed-in user, or 401. While an administrator-set password is pending a
 * change, only routes that pass `allowPendingPasswordChange` (the account and
 * /api/me endpoints) are usable; everything else answers 403 PASSWORD_CHANGE_REQUIRED.
 */
export async function requireUser(opts: { allowPendingPasswordChange?: boolean } = {}): Promise<Principal> {
  const p = await getPrincipal();
  if (!p) throw unauthenticated();
  if (p.mustChangePassword && !opts.allowPendingPasswordChange) {
    throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change the password your administrator set before continuing.");
  }
  return p;
}

export async function requirePermission(permission: Permission): Promise<Principal> {
  const p = await requireUser();
  assertPermission(p, permission);
  return p;
}
