"use server";

import { AuthError, CredentialsSignin } from "next-auth";
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
  try {
    await signIn("credentials", { email: input.email, password: input.password, ...(input.code ? { code: input.code } : {}), redirectTo: ROUTES.dashboard });
    return { error: "" };
  } catch (e) {
    if (e instanceof CredentialsSignin && e.code === "mfa_required") return { error: "", mfaRequired: true };
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
