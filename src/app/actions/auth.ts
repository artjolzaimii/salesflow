"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { ROUTES } from "@/lib/navigation";

export interface SignInResult {
  error: string;
}

/**
 * Email/password sign-in. On success Auth.js sets the session cookie and
 * redirects (the thrown redirect must propagate). Every failure gives the same
 * message, so the form can't reveal whether an account exists or is disabled.
 */
export async function signInAction(input: { email: string; password: string }): Promise<SignInResult> {
  try {
    await signIn("credentials", { email: input.email, password: input.password, redirectTo: ROUTES.dashboard });
    return { error: "" };
  } catch (e) {
    if (e instanceof AuthError) return { error: "Email or password is incorrect, or the account is disabled." };
    throw e;
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: ROUTES.login });
}
