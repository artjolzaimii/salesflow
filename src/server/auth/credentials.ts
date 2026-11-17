import "server-only";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db";

/** bcrypt cost for new password hashes (seed and future user administration). */
export const PASSWORD_HASH_COST = 12;

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
  password: z.string().min(1).max(200),
});

export interface VerifiedUser {
  id: string;
  email: string;
}

// Compared against when the email is unknown, so the response time doesn't
// reveal which emails have accounts.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hash(randomUUID(), PASSWORD_HASH_COST));

/* Failed-attempt throttle: per email, in process memory. A multi-instance
   deployment needs a shared store (see docs/auth.md). */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, number[]>();

function recentFailures(key: string, now: number): number[] {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export function resetLoginThrottle() {
  failures.clear();
}

/**
 * Returns the user for a correct email/password pair, or null. Unknown email,
 * wrong password, a disabled user or a disabled employee record all give the
 * same null, so the login form can't be used to discover accounts.
 */
export async function verifyCredentials(raw: unknown): Promise<VerifiedUser | null> {
  const parsed = credentialsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const now = Date.now();
  if (recentFailures(email, now).length >= MAX_FAILURES) return null;

  const user = await getDb().user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true, isActive: true, employee: { select: { isActive: true } } },
  });
  const ok = await compare(password, user?.passwordHash ?? (await getDummyHash()));
  const enabled = !!user && user.isActive && (user.employee ? user.employee.isActive : true);

  if (!user || !ok || !enabled) {
    failures.set(email, [...recentFailures(email, now), now]);
    return null;
  }
  failures.delete(email);
  return { id: user.id, email: user.email };
}
