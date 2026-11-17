import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Server-side Prisma client (Prisma 7, node-postgres driver adapter).
 *
 * Used only by server code (route handlers, services, the session layer).
 * `server-only` makes any accidental import from a Client Component a build
 * error, so DATABASE_URL can never reach the browser bundle.
 *
 * Created lazily so builds without DATABASE_URL still succeed. Exactly one
 * client (one connection pool) per server process, cached on globalThis in
 * every environment: Next.js may load this module once per route bundle, and
 * hot reloads re-evaluate it in development. (An earlier version cached only in
 * development, which opened a new pool per call in production and exhausted
 * PostgreSQL's connections; tests/http/modules-api.test.ts guards against that.)
 */
const globalForPrisma = globalThis as unknown as { salesflowDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.salesflowDb) return globalForPrisma.salesflowDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env for local development.");
  globalForPrisma.salesflowDb = new PrismaClient({ adapter: new PrismaPg(poolConfig(connectionString)) });
  return globalForPrisma.salesflowDb;
}

const envInt = (name: string, fallback: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Pool limits (docs/security.md): a bounded pool per instance, a connect
 * timeout so a stuck database fails fast, and a per-statement timeout so no
 * single query (for example a large report) can hold a connection indefinitely.
 * DATABASE_STATEMENT_TIMEOUT_MS=0 leaves the timeout to the database role
 * (ALTER ROLE … SET statement_timeout), for poolers that reject startup parameters.
 */
export function poolConfig(connectionString: string, env: Record<string, string | undefined> = process.env) {
  const timeout = env.DATABASE_STATEMENT_TIMEOUT_MS === "0" ? undefined : envInt("DATABASE_STATEMENT_TIMEOUT_MS", 30_000, 1_000, 600_000);
  return {
    ...tlsConfig(connectionString, env.DATABASE_SSL_CA),
    max: envInt("DATABASE_POOL_MAX", 10, 1, 200),
    connectionTimeoutMillis: envInt("DATABASE_CONNECT_TIMEOUT_MS", 10_000, 500, 120_000),
    idleTimeoutMillis: 30_000,
    ...(timeout ? { statement_timeout: timeout } : {}),
    application_name: "salesflow",
  };
}

/**
 * Verified TLS against a database whose certificate comes from a private CA
 * (Supabase signs its servers with its own root). DATABASE_SSL_CA holds that CA
 * certificate (PEM). node-postgres lets TLS settings in the URL override the
 * `ssl` option, so the URL's own TLS parameters are removed and the connection
 * verifies the server certificate and hostname against this CA only.
 * Without DATABASE_SSL_CA the URL is used unchanged.
 */
function tlsConfig(connectionString: string, caPem: string | undefined) {
  const ca = caPem?.trim().replace(/\\n/g, "\n");
  if (!ca) return { connectionString };
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw new Error("DATABASE_SSL_CA must be a PEM certificate.");
  const url = new URL(connectionString);
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat", "ssl"]) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
}
