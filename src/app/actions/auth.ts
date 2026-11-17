"use server";

import { headers } from "next/headers";
import { AuthError, CredentialsSignin } from "next-auth";
import { clientIp, consume, isLimited } from "@/server/rate-limit";
import { logEvent } from "@/server/log";
import { signIn, signOut } from "@/auth";
import { ROUTES } from "@/lib/navigation";

export interface SignInResult {
  error: string;
  /** The password was right and the account has MFA: ask for a code. */
  mfaRequired?: boolean;
}

/**
 * Email/password sign-in, with a second step for accounts with MFA (TOTP code
 * or recovery code). On success Auth.js sets the session cookie and redirects
 * (the thrown redirect must propagate). Password failures give one generic
 * message, so the form can't reveal whether an account exists or is disabled.
 */
export async function signInAction(input: { email: string; password: string; code?: string }): Promise<SignInResult> {
  // Shared per-IP limit on failed sign-ins (successful ones never count).
  const ip = clientIp(await headers());
  if (ip && !(await isLimited("signin", ip)).ok) {
    logEvent("signin_rate_limited", { via: "form" }, "warn");
    return { error: "Too many failed sign-in attempts from this network. Wait 15 minutes and try again." };
  }
  try {
    await signIn("credentials", { email: input.email, password: input.password, ...(input.code ? { code: input.code } : {}), redirectTo: ROUTES.dashboard });
    return { error: "" };
  } catch (e) {
    if (e instanceof CredentialsSignin && e.code === "mfa_required") return { error: "", mfaRequired: true };
    if (e instanceof AuthError && ip) await consume("signin", ip);
    if (e instanceof CredentialsSignin && e.code === "mfa_invalid") {
      return { error: "That code isn't valid or was already used. After 5 wrong codes, wait 15 minutes.", mfaRequired: true };
    }
    if (e instanceof AuthError) return { error: "Email or password is incorrect, or the account is disabled." };
    throw e;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: ROUTES.login });
}
