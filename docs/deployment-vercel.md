# Deploying SalesFlow on Vercel and Supabase

This is the concrete deployment path:
- **Vercel** runs the Next.js app and API routes.
- **Supabase PostgreSQL 17** holds the data.
- **GitHub** keeps the code in a private repository.

`docs/deployment.md` remains the general reference for monitoring, backups, rollback and capacity. This guide contains no credentials: every `<…>` comes from your password manager or the provider dashboards.

## Compatibility review

| Area | Finding | Change |
|---|---|---|
| Prisma 7 + `@prisma/adapter-pg` | Works through Supabase's **transaction pooler** (port 6543). There are no session-level advisory locks, `LISTEN`, `SET` or prepared-statement names. Every lock is `pg_advisory_xact_lock` inside a transaction. | None |
| Pool size | Vercel Functions (Fluid compute) reuse instances; the pooler multiplexes them. | `DATABASE_POOL_MAX=5` |
| **Database TLS** | `pg` 8.2x treats `sslmode=require` as full verification. Supabase signs with its own CA, so connections failed with `SELF_SIGNED_CERT_IN_CHAIN`, which was verified against Supabase's pooler. | `DATABASE_SSL_CA` (the project's CA certificate, PEM) makes the app verify the certificate and hostname against that CA. The production check refuses a Supabase URL without it. |
| Statement timeout | `pg` sends `statement_timeout` as a startup parameter; Supabase's pooler silently ignores it (verified). The 30 s limit comes from the `salesflow_app` role (`scripts/db/supabase.sql`, verified effective through port 6543). | None (`0` available to skip sending it) |
| **Supabase Data API** | By default Supabase grants its public `anon`/`authenticated` roles full access to new tables in `public` and serves them over REST/GraphQL. Unchanged, anyone holding the public anon key could read `users` (password hashes) and all financial tables. | Turn the Data API off, **and** run `scripts/db/supabase.sql` (revokes those grants, now and for future tables) |
| Least privilege | Migrations run as `postgres` (owner); the app runs as `salesflow_app` (rows only, can't drop/alter tables or triggers). | `scripts/db/supabase.sql` |
| Build | A clean checkout builds without reaching the database (verified with an unreachable `DATABASE_URL`). `prisma generate` runs on install. | None |
| Auth.js | JWT cookie and server-side session rows in the database: stateless, works across instances. `AUTH_URL` pins the origin; Vercel is a trusted host automatically. | None |
| Rate limiting | Stored in PostgreSQL, shared across instances. Vercel sets `x-real-ip` itself. | `CLIENT_IP_HEADER=x-real-ip` |
| Transactions | Interactive Prisma transactions each run on one pooled connection; financial triggers and constraints live in the database. | None |
| AI assistant | Each question is bounded by `ASSISTANT_TIMEOUT_MS` (90 s), within Vercel's default 300 s function duration. Daily USD caps are enforced in the database. | None |
| Startup check | Runs on the first request of each function instance (`src/instrumentation.ts`); a misconfigured deployment stops instead of serving. | None |
| First administrator | No seed in production. | `scripts/create-first-admin.mjs` (one-time setup link) |

## Plans and costs (your decision)

- **Vercel Hobby** is free but limited to **personal, non-commercial use**. A business app should use **Vercel Pro** (paid, per member).
- **Supabase Free** pauses projects after a week without activity, and offers no point-in-time recovery or downloadable daily backups. For business data use **Supabase Pro** (paid). Add the PITR add-on if you need point-in-time restore.
- **Anthropic**: pay per use, capped in-app at USD 50 per day overall and 5 per user. Also set a spend limit in the Anthropic Console.

## Step 1: Private GitHub repository

The repository is created as **private** (`gh repo create <name> --private --source . --push`), and only the `main` branch is pushed.

Files kept out of Git by `.gitignore`: `.env*` (except `.env.example`), `.next`, `node_modules`, `src/generated` and `*.pem`. Production secrets live only in Vercel and in your password manager.

## Step 2: Supabase project

1. Create a project.
   - Organization plan: see above.
   - **Region: `eu-central-1` (Frankfurt)**, close to Albania; use the same region for Vercel.
   - Let Supabase generate a strong database password and store it in your password manager.
   - At creation, **untick "Enable Data API"**. If the project already exists: Project Settings → Data API → disable.
2. Database → Settings → **SSL Configuration**:
   - turn on **Enforce SSL on incoming connections**;
   - **Download certificate** (the project's CA, `prod-ca-2021.crt` or similar). It is public, not a secret, but keep it with the deployment notes.
3. Connect (top bar) → **Connection string**. You need two of them:
   - **Transaction pooler** (port **6543**), for the app;
   - **Session pooler** (port **5432**), for migrations and admin scripts. It works over IPv4, unlike the direct connection.

## Step 3: Local operator file (never committed)

Migrations and the admin scripts run from your Mac. Keep their settings **outside the repository**: Next.js would load an `.env.production.local` in the project during local production builds and tests.

```bash
mkdir -p ~/.config/salesflow && chmod 700 ~/.config/salesflow
cp ~/Downloads/prod-ca-2021.crt ~/.config/salesflow/supabase-ca.crt
touch ~/.config/salesflow/production.env && chmod 600 ~/.config/salesflow/production.env
```

`~/.config/salesflow/production.env` contains:
```bash
# Session pooler, as the postgres owner role (migrations, roles, first admin)
MIGRATION_DATABASE_URL="postgresql://postgres.<project-ref>:<db-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require"
# Password for the application role created by scripts/db/supabase.sql (generate: openssl rand -base64 30 | tr -d '/+=')
APP_DB_PASSWORD="<generated>"
```

## Step 4: Database: migrations and roles (needs your approval)

Never run `migrate dev`, `migrate reset`, `db push` or the seed against production.

```bash
set -a; source ~/.config/salesflow/production.env; set +a
CA=~/.config/salesflow/supabase-ca.crt

# 1. Apply the committed migrations (the URL must end in ?sslmode=require, see the note below)
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate status

# 2. Lock down the Data API roles, create salesflow_app (run again after future migrations)
PGSSLMODE=verify-full PGSSLROOTCERT=$CA psql "${MIGRATION_DATABASE_URL%%\?*}" -v app_password="$APP_DB_PASSWORD" -f scripts/db/supabase.sql
```

**TLS for migrations (verified 2026-11-18).** Prisma's schema engine treats `sslmode=require` as "encrypt, don't verify", ignores `verify-full`, and its strict mode (`sslcert=…&sslaccept=strict`) rejects Supabase's CA with `P1011`. So migrations run encrypted but unverified. Supabase refuses non-TLS connections, so encryption is guaranteed. `psql` (`PGSSLMODE=verify-full`) and the running application verify the certificate and hostname.

## Step 5: Vercel project and environment variables

1. Vercel → Add New → Project → import the private GitHub repository. The framework is detected as Next.js; keep the defaults: `npm install`, `next build`, Node 24.
2. Settings → Functions → **Region: Frankfurt (`fra1`)**, matching Supabase.
3. Settings → Environment Variables, scoped to **Production** only (preview deployments don't get production secrets):

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://salesflow_app.<project-ref>:<APP_DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?sslmode=verify-full` (transaction pooler, application role) |
| `DATABASE_SSL_CA` | Full contents of the CA certificate file, `-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----` (multi-line value) |
| `DATABASE_POOL_MAX` | `5` |
| `AUTH_SECRET` | `openssl rand -base64 33` (new, production-only) |
| `AUTH_URL` | `https://<project>.vercel.app` (or your custom domain later; update it when the domain changes) |
| `MFA_ENCRYPTION_KEY` | `openssl rand -base64 32`, **also stored in your password manager**: losing it disables every enrolled MFA |
| `CLIENT_IP_HEADER` | `x-real-ip` |
| `ANTHROPIC_API_KEY` | Claude: your key (optional; without a provider the assistant reports "not configured") |
| `ASSISTANT_MODEL` | Claude: `claude-opus-5-5` (the default) |

**Free alternative (current production setup): Groq.** Instead of `ANTHROPIC_API_KEY`, set `ASSISTANT_PROVIDER=openai-compatible`, `ASSISTANT_BASE_URL=https://api.groq.com/openai/v1`, `ASSISTANT_API_KEY=<Groq key>` and `ASSISTANT_MODEL=<a Groq model with tool use>`. Answers are costed at $0, so the daily USD caps don't apply; the hourly and concurrency limits do. See docs/assistant.md for the data terms.

Optional (defaults are fine): `ASSISTANT_DAILY_USD_TOTAL` (50), `ASSISTANT_DAILY_USD_PER_USER` (5), `DATABASE_STATEMENT_TIMEOUT_MS`, `RATE_LIMIT_*`.

**Do not set:** `AUTH_TRUST_HOST`, `SEED_DEMO_PASSWORD`, `ASSISTANT_PROVIDER`, `ASSISTANT_FALLBACKS`, `MFA_ALLOW_DERIVED_KEY` or `SALESFLOW_CONFIG_CHECK`.

**Reference data.** Migrations also create the reference currencies (ALL, EUR, USD; migration `20261123090000_reference_currencies`). Exchange rates for EUR and USD are business data: enter them in the app before creating orders in those currencies. ALL needs no rate.

## Step 6: Deploy

Deploy from the Vercel dashboard. Afterwards, every push to `main` deploys to production.

On the first request, the instance validates its configuration. Problems show in the Vercel function logs as `config_error` lines and the instance stops.

## Step 7: First administrator (needs your approval)

```bash
set -a; source ~/.config/salesflow/production.env; set +a
ADMIN_EMAIL="<your work email>" APP_URL="https://<project>.vercel.app" \
DATABASE_URL="${MIGRATION_DATABASE_URL%%\?*}" DATABASE_SSL_CA="$(cat ~/.config/salesflow/supabase-ca.crt)" \
node scripts/create-first-admin.mjs
```

The script creates the administrator with **no usable password** and prints a **one-time setup link**, valid for 24 hours and stored only as a hash. It refuses to run if an administrator already exists.

1. Open the link and choose a password: at least 12 characters, not containing your name or email.
2. Sign in, then go to **Account security → turn on two-step verification** and save the recovery codes.
3. Create everyone else in **User management** using setup links.

## Step 8: Verify

| Check | How |
|---|---|
| Health | `curl https://<host>/api/health` → `{"status":"ok"}` |
| HTTPS + headers | `curl -sI https://<host>/login` → `strict-transport-security`, `content-security-policy` |
| Login, MFA | Sign in as the administrator; enable MFA; sign out and in with a code |
| Dashboard, customers, products, orders, invoices, payments, reports | Open each screen (empty until data is entered) |
| Assistant | Opens and reports configured / not configured. **Asking a question is a paid API call**: only with approval |
| Operations | `GET /api/ops/summary` (admin): all migrations applied, 0 failed |
| Database security | As `anon` nothing is readable: the `supabase.sql` report shows no rows for `anon`/`authenticated` |

## Afterwards

- Add a custom domain in Vercel, then update `AUTH_URL` and redeploy.
- Set up an uptime check on `/api/health`.
- Set the Anthropic Console spend limit.
- Schedule a restore drill (`docs/deployment.md` §11).
- Future releases: push to `main`. If a release contains migrations, run Step 4 **before** pushing, so the old code keeps working on the expanded schema.
