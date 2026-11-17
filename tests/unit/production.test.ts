import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { checkConfig } from "@/server/config-check";
import { databaseAvailabilityError, mapDatabaseError } from "@/server/errors";
import { checkHealth, type HealthDb } from "@/server/health";
import { isFinancialWrite } from "@/server/http";
import { markShuttingDown, resetLifecycle } from "@/server/lifecycle";
import { clientIp } from "@/server/rate-limit";

const GOOD = {
  DATABASE_URL: "postgresql://salesflow_app:x@db.internal.example:5432/salesflow?sslmode=require",
  AUTH_SECRET: "k".repeat(44),
  AUTH_URL: "https://sales.example.al",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ANTHROPIC_API_KEY: "present",
  CLIENT_IP_HEADER: "x-real-ip",
};

describe("production configuration check", () => {
  it("accepts a complete production configuration", () => {
    expect(checkConfig(GOOD)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses insecure or incomplete settings", () => {
    const errs = (env: Record<string, string | undefined>) => checkConfig({ ...GOOD, ...env }).errors.join(" | ");
    expect(errs({ DATABASE_URL: "postgresql://u:p@db.example:5432/x" })).toMatch(/without TLS/);
    expect(errs({ DATABASE_URL: "postgresql://u:p@db.example:5432/x?sslmode=disable" })).toMatch(/TLS/);
    expect(errs({ DATABASE_URL: undefined })).toMatch(/DATABASE_URL is missing/);
    expect(errs({ AUTH_SECRET: "short" })).toMatch(/too short/);
    expect(errs({ AUTH_SECRET: "test-only-auth-secret-0123456789abcdefghijklmnop" })).toMatch(/test-suite secret/);
    expect(errs({ AUTH_URL: "http://sales.example.al" })).toMatch(/https/);
    expect(errs({ AUTH_URL: undefined })).toMatch(/AUTH_URL is not set/);
    expect(errs({ MFA_ENCRYPTION_KEY: undefined })).toMatch(/MFA_ENCRYPTION_KEY is not set/);
    expect(errs({ MFA_ENCRYPTION_KEY: "c2hvcnQ=" })).toMatch(/32 bytes/);
    expect(errs({ SEED_DEMO_PASSWORD: "anything" })).toMatch(/demo seeding/);
    expect(errs({ ASSISTANT_PROVIDER: "scripted" })).toMatch(/offline test provider/);
    expect(errs({ MFA_ALLOW_DERIVED_KEY: "true" })).toMatch(/MFA_ALLOW_DERIVED_KEY/);
  });

  it("warns about optional or risky settings without blocking", () => {
    const r = checkConfig({ ...GOOD, ANTHROPIC_API_KEY: undefined, CLIENT_IP_HEADER: undefined, AUTH_TRUST_HOST: "true", ASSISTANT_FALLBACKS: "default" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" | ")).toMatch(/assistant is disabled.*per-IP|per-IP.*assistant is disabled|AUTH_TRUST_HOST/);
    expect(r.warnings).toHaveLength(4);
    expect(checkConfig({ ...GOOD, DATABASE_URL: "postgresql://postgres:x@localhost:5432/salesflow" }).warnings.join()).toMatch(/superuser/);
  });
});

describe("database availability errors", () => {
  const adapterError = (cause: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError("driver error", { code: "P2010", clientVersion: "7", meta: { driverAdapterError: { cause } } });

  it("maps outages and timeouts to 503 with Retry-After, and leaves other errors alone", () => {
    expect(databaseAvailabilityError(new Prisma.PrismaClientInitializationError("no db", "7"))).toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });
    expect(databaseAvailabilityError(new Prisma.PrismaClientKnownRequestError("x", { code: "P1001", clientVersion: "7" }))).toMatchObject({ status: 503 });
    expect(databaseAvailabilityError(adapterError({ originalCode: "57014" }))).toMatchObject({ status: 503, code: "QUERY_TIMEOUT", details: { retryAfterSec: 5 } });
    expect(databaseAvailabilityError(adapterError({ kind: "DatabaseNotReachable" }))).toMatchObject({ code: "DATABASE_UNAVAILABLE" });
    expect(databaseAvailabilityError(adapterError({ originalCode: "57P01" }))).toMatchObject({ code: "DATABASE_UNAVAILABLE" }); // admin shutdown
    expect(databaseAvailabilityError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toMatchObject({ status: 503 });
    expect(databaseAvailabilityError(new Error("boom"))).toBeNull();
    expect(databaseAvailabilityError(adapterError({ originalCode: "23505" }))).toBeNull();
    expect(mapDatabaseError(adapterError({ originalCode: "57014" }))).toMatchObject({ status: 503 });
  });
});

describe("health check", () => {
  afterEach(() => resetLifecycle());
  const db = (opts: { fail?: boolean; failedMigrations?: number; hang?: boolean }): HealthDb => ({
    async $queryRaw(q: TemplateStringsArray) {
      if (opts.hang) await new Promise((r) => setTimeout(r, 1000));
      if (opts.fail) throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      return (q.join("").includes("_prisma_migrations") ? [{ failed: opts.failedMigrations ?? 0 }] : [{ "?column?": 1 }]) as never;
    },
  });

  it("is ok only when the database answers and no migration failed, and never shows details", async () => {
    expect(await checkHealth(db({}))).toEqual({ status: "ok" });
    const down = await checkHealth(db({ fail: true }));
    expect(down).toEqual({ status: "unavailable", reason: "database" });
    expect(JSON.stringify(down)).not.toContain("10.0.0.5");
    expect(await checkHealth(db({ failedMigrations: 1 }))).toEqual({ status: "unavailable", reason: "migrations" });
    expect(await checkHealth(db({ hang: true }), 100)).toEqual({ status: "unavailable", reason: "database" });
  });

  it("reports shutting down so the load balancer drains this instance", async () => {
    markShuttingDown();
    expect(await checkHealth(db({}))).toEqual({ status: "shutting_down", reason: "shutting_down" });
  });
});

describe("request classification and client IP", () => {
  afterEach(() => {
    delete process.env.CLIENT_IP_HEADER;
  });

  it("classifies financial writes", () => {
    expect(isFinancialWrite("POST", "/api/payments")).toBe(true);
    expect(isFinancialWrite("PATCH", "/api/orders/123")).toBe(true);
    expect(isFinancialWrite("POST", "/api/invoices/1/cancel")).toBe(true);
    expect(isFinancialWrite("POST", "/api/orders/quote")).toBe(false);
    expect(isFinancialWrite("GET", "/api/invoices")).toBe(false);
    expect(isFinancialWrite("POST", "/api/customers")).toBe(false);
    expect(isFinancialWrite("POST", "/api/ordersx")).toBe(false);
  });

  it("trusts only the configured proxy header", () => {
    const h = new Headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9", "x-real-ip": "198.51.100.4" });
    expect(clientIp(h)).toBeNull(); // nothing configured: no IP-based limits
    process.env.CLIENT_IP_HEADER = "x-real-ip";
    expect(clientIp(h)).toBe("198.51.100.4");
    process.env.CLIENT_IP_HEADER = "X-Forwarded-For";
    expect(clientIp(h)).toBe("203.0.113.9"); // the entry the trusted proxy appended, not the client-supplied first one
    expect(clientIp(new Headers())).toBeNull();
  });
});
