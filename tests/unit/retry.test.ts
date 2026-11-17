import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isRetryableTransactionError } from "@/server/errors";
import { withTransactionRetry } from "@/server/retry";

const pgError = (prismaCode: string, sqlstate: string, message = "x") =>
  new Prisma.PrismaClientKnownRequestError(message, {
    code: prismaCode,
    clientVersion: "test",
    meta: { driverAdapterError: { cause: { originalCode: sqlstate, originalMessage: message } } },
  });

describe("transaction retry", () => {
  it("classifies serialization failures and deadlocks as retryable, nothing else", () => {
    expect(isRetryableTransactionError(pgError("P2034", "40001"))).toBe(true);
    expect(isRetryableTransactionError(pgError("P2034", "40P01"))).toBe(true);
    expect(isRetryableTransactionError(pgError("P2039", "P0001", "Overpayment forbidden"))).toBe(false);
    expect(isRetryableTransactionError(pgError("P2002", "23505"))).toBe(false);
    expect(isRetryableTransactionError(new Error("could not serialize access"))).toBe(false);
  });

  it("retries a serialization failure and returns the later success", async () => {
    let calls = 0;
    const out = await withTransactionRetry(
      async () => {
        if (++calls < 3) throw pgError("P2034", "40001");
        return "ok";
      },
      { baseDelayMs: 1 },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry business errors", async () => {
    let calls = 0;
    await expect(
      withTransactionRetry(async () => {
        calls++;
        throw pgError("P2039", "P0001", "Overpayment forbidden");
      }),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("gives up after the bounded number of attempts with a 503", async () => {
    let calls = 0;
    const err = await withTransactionRetry(
      async () => {
        calls++;
        throw pgError("P2034", "40001");
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    ).catch((e) => e);
    expect(calls).toBe(3);
    expect(err).toMatchObject({ status: 503, code: "CONCURRENT_UPDATE" });
  });
});
