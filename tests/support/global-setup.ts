import { execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { ADMIN_URL, DEMO_PASSWORD, TEST_AUTH_SECRET, TEST_DATABASE_URL, TEST_DB_NAME, TEST_PORT } from "./env";

/**
 * Builds a throwaway database from the version-controlled migrations plus the
 * seed (never the development database), and, if a production build exists,
 * starts `next start` against it for the HTTP suite.
 */
let server: ChildProcess | undefined;

async function recreateDatabase() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
}

export default async function setup(project: TestProject) {
  await recreateDatabase();
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SEED_DEMO_PASSWORD: DEMO_PASSWORD, NODE_ENV: "development" as const };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });

  let baseUrl = "";
  if (existsSync(".next/BUILD_ID")) {
    server = spawn("npx", ["next", "start", "-p", String(TEST_PORT)], {
      // Offline scripted assistant provider and no API key: the HTTP and browser suites never call a paid API.
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET, AUTH_TRUST_HOST: "true", NODE_ENV: "production", ASSISTANT_PROVIDER: "scripted", ANTHROPIC_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Server output for diagnosing HTTP-suite failures (.next/ is git-ignored).
    const log = createWriteStream(".next/test-server.log");
    server.stdout?.pipe(log);
    server.stderr?.pipe(log);
    baseUrl = `http://localhost:${TEST_PORT}`;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(baseUrl + "/login")).ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  project.provide("baseUrl", baseUrl);

  return async () => {
    server?.kill();
    const admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}
