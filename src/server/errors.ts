import { Prisma } from "@/generated/prisma/client";

/**
 * Errors the business layer raises on purpose. Route handlers turn them into
 * JSON responses with the given HTTP status; anything else becomes a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Sign in required.");
export const forbidden = (message = "You do not have permission to do this.") => new AppError(403, "FORBIDDEN", message);
/** Also used for records outside the caller's scope, so their existence is not disclosed. */
export const notFound = (what = "Record") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const invalid = (message: string, details?: unknown) => new AppError(422, "VALIDATION_FAILED", message, details);

interface DriverCause {
  originalCode?: string;
  originalMessage?: string;
  kind?: string;
  constraint?: { index?: string };
}

/** The PostgreSQL error behind a Prisma 7 driver-adapter error, if any. */
export function pgCause(e: unknown): DriverCause | undefined {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = e.meta as { driverAdapterError?: { cause?: DriverCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

/** SQLSTATE 40001 (serialization failure) or 40P01 (deadlock): safe to retry the whole transaction. */
export function isRetryableTransactionError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const code = pgCause(e)?.originalCode;
  if (code) return code === "40001" || code === "40P01";
  return e.code === "P2034";
}

export function isUniqueViolation(e: unknown, index?: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
  return !index || pgCause(e)?.constraint?.index === index;
}

/**
 * Messages raised by the financial guard triggers (prisma/migrations), mapped to
 * stable API errors. The database stays the final authority; services pre-check
 * the common cases only to give clearer messages.
 */
const GUARD_ERRORS: Record<string, [number, string]> = {
  "Overpayment forbidden": [409, "OVERPAYMENT"],
  "Invoice not payable": [409, "INVOICE_NOT_PAYABLE"],
  "Payment currency must match invoice": [422, "CURRENCY_MISMATCH"],
  "Cannot cancel invoice with payments": [409, "INVOICE_HAS_PAYMENTS"],
  "Cancelled invoice is final": [409, "INVOICE_CANCELLED"],
  "Order already has an issued invoice": [409, "ORDER_ALREADY_INVOICED"],
  "Invoice requires a confirmed order": [409, "ORDER_NOT_INVOICEABLE"],
  "Replacement must reference a cancelled invoice of the same order": [409, "INVALID_REPLACEMENT"],
  "Replacement invoice must reference the cancelled invoice it replaces": [409, "INVALID_REPLACEMENT"],
  "Invoiced order is financially locked": [409, "ORDER_FINANCIALLY_LOCKED"],
  "Cannot change items of an invoiced order": [409, "ORDER_FINANCIALLY_LOCKED"],
  "Cannot cancel an order with an issued invoice": [409, "ORDER_HAS_ISSUED_INVOICE"],
};

export function mapDatabaseError(e: unknown): unknown {
  const cause = pgCause(e);
  if (cause?.originalCode !== "P0001" || !cause.originalMessage) return e;
  const msg = cause.originalMessage;
  if (msg.startsWith("Invalid order status transition")) return conflict("INVALID_STATUS_TRANSITION", msg);
  const hit = GUARD_ERRORS[msg];
  return hit ? new AppError(hit[0], hit[1], msg) : e;
}
