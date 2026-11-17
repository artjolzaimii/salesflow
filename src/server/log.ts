import "server-only";
import { Prisma } from "@/generated/prisma/client";

/**
 * Error logging without confidential data. Full error objects are never
 * logged: Prisma validation errors print the whole query arguments (which can
 * include password hashes or customer data), and driver errors can carry
 * parameter values. A log line has the scope, the error class, a code when
 * there is one, and a short, redacted first line of the message.
 */
const REDACT: [RegExp, string][] = [
  [/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, "[bcrypt-hash]"],
  [/sk-ant-[A-Za-z0-9_-]+/g, "[api-key]"],
  [/postgres(?:ql)?:\/\/[^\s"']+/g, "[database-url]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

export function describeError(e: unknown): { name: string; code?: string; message: string } {
  if (e instanceof Prisma.PrismaClientValidationError) return { name: e.name, message: "Invalid database query (arguments omitted)." };
  const err = e as { name?: string; code?: unknown; message?: unknown } | null;
  let message = typeof err?.message === "string" ? err.message.split("\n")[0].slice(0, 300) : String(e).slice(0, 300);
  for (const [re, sub] of REDACT) message = message.replace(re, sub);
  return { name: typeof err?.name === "string" ? err.name : typeof e, code: typeof err?.code === "string" ? err.code : undefined, message };
}

export function logError(scope: string, e: unknown, context?: Record<string, string | number | boolean | null>) {
  console.error(`[${scope}]`, JSON.stringify({ ...describeError(e), ...(context ?? {}) }));
}
