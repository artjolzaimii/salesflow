import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same values as tests/support/env.ts (kept inline: Vite's native config loader can't import .ts).
const TEST_DATABASE_URL = "postgresql://salesflow:salesflow_dev@localhost:5433/salesflow_test?schema=public";
const TEST_AUTH_SECRET = "test-only-auth-secret-0123456789abcdefghijklmnop";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/support/global-setup.ts"],
    // Files share one test database; run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: TEST_DATABASE_URL, AUTH_SECRET: TEST_AUTH_SECRET },
  },
});
