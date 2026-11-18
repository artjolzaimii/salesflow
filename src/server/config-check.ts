/**
 * Production configuration check (docs/deployment.md), run once at startup by
 * src/instrumentation.ts. In production the server refuses to start while any
 * error remains, unless SALESFLOW_CONFIG_CHECK=warn (for local production-mode
 * runs such as the test server), which logs the same findings instead.
 *
 * Pure function over an env object, so it is unit-tested without a server.
 */
export interface ConfigReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "db"]);
const PLACEHOLDER_SECRETS = new Set(["", "changeme", "change-me", "secret", "replace-me"]);

function url(v: string | undefined): URL | null {
  try {
    return v ? new URL(v) : null;
  } catch {
    return null;
  }
}

export function checkConfig(env: Env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Database
  const db = url(env.DATABASE_URL);
  if (!db) errors.push("DATABASE_URL is missing or not a valid URL.");
  else {
    const ssl = db.searchParams.get("sslmode");
    const local = LOCAL_HOSTS.has(db.hostname);
    if (!local && !["require", "verify-ca", "verify-full"].includes(ssl ?? "")) {
      errors.push(`DATABASE_URL points at ${db.hostname} without TLS: add sslmode=require (or verify-full).`);
    }
    const ca = env.DATABASE_SSL_CA;
    if (ca && !ca.includes("-----BEGIN CERTIFICATE-----")) errors.push("DATABASE_SSL_CA must be the database CA certificate in PEM format.");
    if (db.hostname.endsWith(".supabase.com") || db.hostname.endsWith(".supabase.co")) {
      if (!ca && db.searchParams.get("uselibpqcompat") === "true") warnings.push("Supabase connection is encrypted but the server certificate isn't verified: set DATABASE_SSL_CA.");
      else if (!ca) errors.push("Supabase uses its own certificate authority: set DATABASE_SSL_CA to the project's CA certificate (docs/deployment-vercel.md).");
    }
    if (db.username === "postgres") warnings.push("DATABASE_URL uses the postgres superuser; use a least-privilege application role (docs/deployment.md).");
    if (ssl === "disable" && !local) errors.push("DATABASE_URL disables TLS for a remote database.");
  }
  const pool = Number(env.DATABASE_POOL_MAX ?? 10);
  if (!Number.isInteger(pool) || pool < 1) errors.push("DATABASE_POOL_MAX must be a positive integer.");

  // Auth.js
  const secret = env.AUTH_SECRET ?? "";
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) errors.push("AUTH_SECRET is missing.");
  else if (secret.length < 32) errors.push("AUTH_SECRET is too short: use at least 32 random characters (openssl rand -base64 33).");
  else if (secret.startsWith("test-only")) errors.push("AUTH_SECRET is the test-suite secret; generate a unique one.");
  const authUrl = url(env.AUTH_URL);
  if (!authUrl) errors.push("AUTH_URL is not set: use the public HTTPS origin, e.g. https://sales.example.al.");
  else if (authUrl.protocol !== "https:") errors.push("AUTH_URL must use https.");
  if (env.AUTH_TRUST_HOST === "true") warnings.push("AUTH_TRUST_HOST=true: only safe behind a proxy that sets X-Forwarded-Host itself; AUTH_URL pins the origin.");

  // MFA
  const mfa = env.MFA_ENCRYPTION_KEY;
  if (!mfa) errors.push("MFA_ENCRYPTION_KEY is not set: two-step verification can't be turned on (openssl rand -base64 32).");
  else if (Buffer.from(mfa, "base64").length !== 32) errors.push("MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  if (env.MFA_ALLOW_DERIVED_KEY === "true") errors.push("MFA_ALLOW_DERIVED_KEY must not be set in production.");

  // Demo data and test-only switches
  if (env.SEED_DEMO_PASSWORD) errors.push("SEED_DEMO_PASSWORD is set: demo seeding is for development only; remove it.");
  if (env.ASSISTANT_PROVIDER === "scripted") errors.push("ASSISTANT_PROVIDER=scripted is the offline test provider; remove it.");

  // Optional features and limits
  const provider = env.ASSISTANT_PROVIDER || "anthropic";
  if (!["anthropic", "openai-compatible", "scripted"].includes(provider)) errors.push(`ASSISTANT_PROVIDER=${provider.slice(0, 40)} is not supported (anthropic or openai-compatible).`);
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) warnings.push("ANTHROPIC_API_KEY is not set: the AI assistant is disabled.");
  if (provider === "openai-compatible") {
    const base = url(env.ASSISTANT_BASE_URL);
    if (!base) errors.push("ASSISTANT_BASE_URL is not set: the OpenAI-compatible endpoint, e.g. https://api.groq.com/openai/v1.");
    else if (base.protocol !== "https:") errors.push("ASSISTANT_BASE_URL must use https.");
    if (!env.ASSISTANT_API_KEY) errors.push("ASSISTANT_API_KEY is not set for the openai-compatible assistant provider.");
    if (!env.ASSISTANT_MODEL) errors.push("ASSISTANT_MODEL is not set for the openai-compatible assistant provider.");
    if (!env.ASSISTANT_INPUT_USD_PER_MTOK && !env.ASSISTANT_OUTPUT_USD_PER_MTOK) warnings.push("Assistant model costed at $0 (free tier): daily USD caps don't limit it; the hourly and concurrency limits still apply.");
  }
  if (env.ASSISTANT_FALLBACKS === "default") warnings.push("ASSISTANT_FALLBACKS=default: refusals are answered by another model (approved?).");
  if (!env.CLIENT_IP_HEADER) warnings.push("CLIENT_IP_HEADER is not set: per-IP sign-in and password-reset limits are off; rely on hosting-layer limits.");

  return { errors, warnings };
}
