import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Server-side Prisma client (Prisma 7, node-postgres driver adapter).
 *
 * Not used by any route yet: Phase 4 only provisions the database. The
 * frontend still runs on the preview store (src/store). `server-only` makes
 * any accidental import from a Client Component a build error, so
 * DATABASE_URL can never reach the browser bundle.
 *
 * Created lazily so builds without DATABASE_URL still succeed, and cached on
 * globalThis in development so hot reloads don't open new connection pools.
 */
const globalForPrisma = globalThis as unknown as { salesflowDb?: PrismaClient };

export function getDb(): PrismaClient {
  if (globalForPrisma.salesflowDb) return globalForPrisma.salesflowDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env for local development.");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.salesflowDb = client;
  return client;
}
