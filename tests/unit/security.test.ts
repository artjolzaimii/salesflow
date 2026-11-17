import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { assistantConfig } from "@/server/assistant/config";
import { describeError } from "@/server/log";

describe("error logging redacts confidential data", () => {
  it("never logs Prisma query arguments", () => {
    const e = new Prisma.PrismaClientValidationError("Invalid `prisma.user.create()` invocation:\n{ data: { passwordHash: \"$2b$12$abc\" } }", { clientVersion: "7" });
    expect(describeError(e)).toEqual({ name: "PrismaClientValidationError", message: "Invalid database query (arguments omitted)." });
  });

  it("keeps one short line and masks hashes, keys, database URLs and emails", () => {
    const hashValue = "$2b$12$" + "a".repeat(53);
    const e = new Error(`failed for manager@salesflow.test with ${hashValue} sk-ant-api03-secretvalue postgresql://u:p@db:5432/x\nsecond line`);
    const d = describeError(e);
    expect(d.message).not.toMatch(/manager@|sk-ant-api03|u:p@db|second line|\$2b\$12\$a/);
    expect(d.message).toContain("[email]");
    expect(d.message).toContain("[bcrypt-hash]");
    expect(d.message).toContain("[api-key]");
    expect(d.message).toContain("[database-url]");
    expect(describeError(new Error("x".repeat(1000))).message.length).toBe(300);
  });
});

describe("assistant safety defaults", () => {
  it("disables the refusal fallback unless explicitly approved", () => {
    const before = process.env.ASSISTANT_FALLBACKS;
    try {
      delete process.env.ASSISTANT_FALLBACKS;
      expect(assistantConfig().fallbacks).toBe("off");
      process.env.ASSISTANT_FALLBACKS = "on";
      expect(assistantConfig().fallbacks).toBe("off");
      process.env.ASSISTANT_FALLBACKS = "default";
      expect(assistantConfig().fallbacks).toBe("default");
    } finally {
      if (before === undefined) delete process.env.ASSISTANT_FALLBACKS;
      else process.env.ASSISTANT_FALLBACKS = before;
    }
  });

  it("has spend and concurrency caps", () => {
    const c = assistantConfig();
    expect(c).toMatchObject({ dailyUsdPerUser: 5, dailyUsdTotal: 50, maxConcurrent: 10, requestsPerHour: 30 });
  });
});
