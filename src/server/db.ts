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
  globalForPrisma.salesflowDb = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return globalForPrisma.salesflowDb;
}
