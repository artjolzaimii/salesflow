import { AppError, isRetryableTransactionError } from "./errors";

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Called before each retry; tests use it to count attempts. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Runs a whole transaction again when PostgreSQL reports a serialization failure
 * or deadlock (40001 / 40P01). The failed attempt was rolled back in full, so a
 * retry cannot leave a duplicate row behind. Every other error (guard trigger,
 * constraint, validation) is thrown immediately: retrying would not change it.
 */
export async function withTransactionRetry<T>(run: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseDelayMs ?? 15;
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (!isRetryableTransactionError(e)) throw e;
      if (attempt >= maxAttempts) {
        throw new AppError(503, "CONCURRENT_UPDATE", "The record is busy with another update. Please try again.");
      }
      opts.onRetry?.(attempt, e);
      // Exponential backoff with full jitter.
      await new Promise((r) => setTimeout(r, Math.random() * base * 2 ** attempt));
    }
  }
}
