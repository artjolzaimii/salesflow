export const TEST_DB_NAME = "salesflow_test";
export const ADMIN_URL = "postgresql://salesflow:salesflow_dev@localhost:5433/postgres";
export const TEST_DATABASE_URL = `postgresql://salesflow:salesflow_dev@localhost:5433/${TEST_DB_NAME}?schema=public`;
/** Test-only secret for the HTTP suite's Next.js server; never used elsewhere. */
export const TEST_AUTH_SECRET = "test-only-auth-secret-0123456789abcdefghijklmnop";
export const TEST_PORT = 3210;
export const DEMO_PASSWORD = "ChangeMe-LocalDemo-2026!";
