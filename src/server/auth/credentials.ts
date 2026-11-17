import "server-only";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb } from "@/server/db";
import { verifyMfa } from "./mfa";
import { clearThrottle, isThrottled, recordThrottleFailure, THROTTLES } from "./throttle";

/** bcrypt cost for password hashes (seed, account administration, password changes). */
export const PASSWORD_HASH_COST = 12;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  password: z.string().min(1).max(200),
  /** TOTP code or recovery code, for accounts with MFA (second step of sign-in). */
  code: z.string().trim().max(40).optional(),
});

export interface VerifiedUser {
  id: string;
  email: string;
  mfaEnabled: boolean;
}

/* Failed-attempt throttle, in the database (src/server/auth/throttle.ts):
   10 failed passwords for one email within 15 minutes lock that email for 15
   minutes, the right password included, with the same response as a wrong one. */
export const THROTTLE_MAX_FAILURES = THROTTLES.email.max;

// Compared against when the email is unknown or locked, so the response time
// doesn't reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash(randomUUID(), PASSWORD_HASH_COST));

/** Clears every throttle (tests only). */
export async function resetLoginThrottle() {
  await getDb().authLoginThrottle.deleteMany({});
}

/**
 * Returns the user for a correct email/password pair, or null. Unknown email,
 * wrong password, a disabled user or a disabled employee record all give the
 * same null, so the login form can't be used to discover accounts. This is the
 * password step only; `authenticate` adds the MFA step.
 */
export async function verifyCredentials(raw: unknown): Promise<{ id: string; email: string } | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const user = await checkPassword(parsed.data.email, parsed.data.password);
  return user ? { id: user.id, email: user.email } : null;
}

/** Password check with throttling, by email (also used for re-authentication). */
export async function checkPassword(email: string, password: string): Promise<VerifiedUser | null> {
  if (await isThrottled("email", email)) {
    await compare(password, await getDummyHash()); // same timing as a real check
    return null;
  }
  const user = await getDb().user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, isActive: true, mfaEnabled: true, employee: { select: { isActive: true } } },
  });
  const ok = await compare(password, user?.passwordHash ?? (await getDummyHash()));
  const enabled = !!user && user.isActive && (user.employee ? user.employee.isActive : true);
  if (!user || !ok || !enabled) {
    await recordThrottleFailure("email", email);
    return null;
  }
  await clearThrottle("email", email);
  return { id: user.id, email: user.email, mfaEnabled: user.mfaEnabled };
}

export type SignInResult =
  | { status: "ok"; user: VerifiedUser }
  | { status: "failed" }
  | { status: "mfa_required" }
  | { status: "mfa_invalid" };

/**
 * Full sign-in check used by Auth.js: password, then (for accounts with MFA) a
 * TOTP or recovery code. Without a code the caller is told a code is needed;
 * that is only revealed after a correct password. Wrong codes are throttled per
 * user (5 in 15 minutes); a locked account answers like a wrong code.
 */
export async function authenticate(raw: unknown): Promise<SignInResult> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return { status: "failed" };
  const user = await checkPassword(parsed.data.email, parsed.data.password);
  if (!user) return { status: "failed" };
  if (!user.mfaEnabled) return { status: "ok", user };
  const code = parsed.data.code;
  if (!code) return { status: "mfa_required" };
  const check = await verifyMfa(user.id, code);
  if (!check.ok) return { status: "mfa_invalid" };
  if (check.method === "recovery") await audit(getDb(), { type: "RECOVERY_CODE_USED", actorUserId: user.id, targetUserId: user.id, details: { context: "sign-in" } });
  return { status: "ok", user };
}
