// Creates the FIRST SalesFlow administrator in a new production database and prints a
// one-time setup link (docs/deployment-vercel.md § First administrator).
//
//   ADMIN_EMAIL=owner@yourcompany.al APP_URL=https://<your-app> \
//   DATABASE_URL=<migration/session url> [DATABASE_SSL_CA=<pem>] node scripts/create-first-admin.mjs
//
// - Refuses to run when any administrator already exists (everyone else is created
//   from User management in the app).
// - No password is chosen or shown: the account gets a random, unknown password hash,
//   and the administrator sets their own password through the link (24 hours, single
//   use, stored only as a SHA-256 hash, carried in the URL fragment, so it never
//   reaches server logs). Then they should turn on two-step verification.
// - Same tables and audit events as the in-app "Create user" flow (Phase 6B).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const appUrl = (process.env.APP_URL ?? process.env.AUTH_URL ?? "").replace(/\/+$/, "");
const url = process.env.DATABASE_URL;
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Set ADMIN_EMAIL to the administrator's email address.");
if (!appUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appUrl)) fail("Set APP_URL to the application's https origin.");
if (!url) fail("Set DATABASE_URL.");

const ca = process.env.DATABASE_SSL_CA?.trim().replace(/\\n/g, "\n");
const connection = new URL(url);
if (ca) for (const k of ["sslmode", "sslrootcert", "uselibpqcompat"]) connection.searchParams.delete(k);
const client = new pg.Client({ connectionString: connection.toString(), ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}), application_name: "salesflow-first-admin" });

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const unknownPasswordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
const userId = randomUUID();

await client.connect();
try {
  await client.query("BEGIN");
  // Serialize with the in-app last-admin guard (same advisory lock key).
  await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [0x5f0003]);
  const { rows } = await client.query("SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN'");
  if (rows[0].n > 0) throw new Error("An administrator already exists; create further users from User management.");
  const taken = await client.query("SELECT 1 FROM users WHERE email = $1", [email]);
  if (taken.rowCount) throw new Error("A user with that email already exists.");
  const now = "(now() AT TIME ZONE 'UTC')";
  await client.query(
    `INSERT INTO users (id, email, password_hash, role, is_active, must_change_password, updated_at)
     VALUES ($1, $2, $3, 'ADMIN', true, false, ${now})`,
    [userId, email, unknownPasswordHash],
  );
  await client.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, purpose, created_by_id, expires_at)
     VALUES ($1, $2, $3, 'SETUP', NULL, ${now} + interval '24 hours')`,
    [randomUUID(), userId, tokenHash],
  );
  await client.query(
    `INSERT INTO security_audit_events (id, event_type, actor_user_id, target_user_id, details)
     VALUES ($1, 'USER_CREATED', NULL, $2, $3), ($4, 'SETUP_LINK_ISSUED', NULL, $2, $5)`,
    [randomUUID(), userId, JSON.stringify({ role: "ADMIN", via: "first-admin-script" }), randomUUID(), JSON.stringify({ expiresInHours: 24 })],
  );
  await client.query("COMMIT");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
  fail(e.message);
}
await client.end();

console.log(`Administrator ${email} created.`);
console.log("One-time setup link (valid 24 hours; open it in a private window, set a password, then enable two-step verification):");
console.log(`${appUrl}/reset-password#token=${token}`);

function fail(message) {
  console.error(`create-first-admin: ${message}`);
  process.exit(1);
}
