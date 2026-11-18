# SalesFlow deployment guide (Phase 6C)

This guide covers how to run SalesFlow in production. For the chosen Vercel + Supabase setup, follow **docs/deployment-vercel.md**. Nothing here has been deployed. The guide contains no credentials: every `<…>` value comes from your secret store.

Related documents: `docs/security.md` covers the security controls, and `docs/database.md` covers the schema and its guards.

## 1. Recommended architecture

```
 users ──HTTPS──▶ managed load balancer / reverse proxy (TLS, HTTP→HTTPS, WAF rate limits)
                     │  sets X-Real-IP (or appends X-Forwarded-For), X-Forwarded-Proto/Host
                     ▼
            1–2 × SalesFlow container  (next start, Node 24, stateless, non-root)
                     │  TLS, pool ≤ 10 per instance
                     ▼
            managed PostgreSQL 17  (automated backups + point-in-time recovery)

 release job:  salesflow-migrate image → prisma migrate deploy (migrator role) → roll out app
 outbound:     api.anthropic.com (AI assistant, optional)
```

This shape suits a small-to-medium business: tens of staff users and thousands of orders and invoices a year. The reasons:

- **The app is stateless.**
  - Sessions, login throttles, rate limits, assistant admission, the audit log and invoice numbering all live in PostgreSQL.
  - Instances share no memory, so a second instance only needs the same environment.
  - There is no file storage: the app neither stores nor serves uploads, and it has no persistent disk.
- **There is no background worker.**
  - Assistant questions run inside the request, bounded by `ASSISTANT_TIMEOUT_MS` (90 s).
  - Housekeeping such as expired sessions and old rate-limit windows happens inline.
  - So no queue, cron or Redis is needed.
- **Costs are predictable.** You pay for one or two small containers (0.5–1 vCPU, 1 GB RAM each), one managed Postgres instance and the Anthropic usage, which is capped in-app.

**Hosting options, in order of preference:**

1. **A container platform with a managed load balancer**: for example a PaaS that runs Docker images (Render, Fly.io, Railway, DigitalOcean App Platform), AWS ECS or App Runner, Google Cloud Run with min-instances 1, or a single VM with Docker and Caddy or nginx.
   - Use the `Dockerfile` in this repository.
   - Pair it with the same provider's managed PostgreSQL in the same region.
   - For Albanian data, prefer an EU region.
2. **Vercel.** This works, with caveats:
   - Many short-lived function instances each open a pool, so use a pooled connection string (PgBouncer or the provider's pooler, in transaction mode) with `DATABASE_POOL_MAX=1`–`3`.
   - Make sure the pooler passes the `statement_timeout` startup parameter; if not, set it on the role (`scripts/db/roles.sql` does).
   - Assistant answers can take up to 90 s, which fits within the default function duration.
   - Set `CLIENT_IP_HEADER=x-real-ip`.

**Not needed:** Kubernetes, Redis, a message queue, object storage, a separate cache tier or a CDN for API traffic.

## 2. Infrastructure requirements

| Component | Requirement |
|---|---|
| Runtime | Node.js 24 (image `node:24.11.1-slim`), 1 GB RAM, `next start` on port 3000 |
| Database | PostgreSQL 17, TLS, ≥ 25 `max_connections` free for the app, automated daily backups + PITR (≥ 7 days) |
| Proxy | TLS termination, HTTP→HTTPS redirect, request-body limit ≥ 256 KB, idle timeout ≥ 120 s (assistant answers), no response buffering requirement |
| Outbound | HTTPS to `api.anthropic.com` (only if the assistant is enabled) |
| Secrets | Platform secret store for the variables in §3 |
| Logs | stdout/stderr collected into a log store with restricted access, retention ≥ 30 days |
| Monitoring | Uptime check on `/api/health`, log-based alerts (§9) |

## 3. Environment variables

The preflight check (`scripts/preflight.mjs`, run by the container before `next start`) refuses to start when a **required** value is missing or unsafe. It runs the same checks as `src/server/config-check.ts`.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | App role (`salesflow_app`), `?sslmode=require` (or `verify-full`) for any non-local host |
| `AUTH_SECRET` | yes | ≥ 32 random chars, unique per environment: `openssl rand -base64 33`. Rotating signs everyone out |
| `AUTH_URL` | yes | Public HTTPS origin, e.g. `https://sales.<your-domain>`. Pins Auth.js URLs to it |
| `MFA_ENCRYPTION_KEY` | yes | 32 bytes base64: `openssl rand -base64 32`. Back it up with the database backups; losing it disables enrolled MFA |
| `CLIENT_IP_HEADER` | strongly recommended | Header your proxy sets to the client IP: `x-real-ip`, `cf-connecting-ip`, or `x-forwarded-for` (last entry is used). Enables per-IP limits. Only set it if the proxy overwrites the header |
| `AUTH_TRUST_HOST` | no | Leave unset when `AUTH_URL` is set |
| `ANTHROPIC_API_KEY` | no | Enables the assistant. Set a spend limit on the key in the Anthropic Console too |
| `ASSISTANT_DAILY_USD_TOTAL` / `_PER_USER` | no | Default 50 / 5 USD per day |
| `ASSISTANT_FALLBACKS` | no | Keep `off` unless explicitly approved |
| `DATABASE_POOL_MAX` | no | Default 10 per instance (see §5) |
| `DATABASE_STATEMENT_TIMEOUT_MS` | no | Default 30000; `0` leaves it to the database role |
| `DATABASE_SSL_CA` | for private CAs | PEM CA certificate to verify the database against (required for Supabase) |
| `RATE_LIMIT_SIGNIN_FAILURES_PER_IP` | no | Default 30 failed sign-ins per 15 min (successful sign-ins don't count) |
| `RATE_LIMIT_PASSWORD_RESET_PER_IP` | no | Default 10 per hour |
| `RATE_LIMIT_WRITES_PER_MINUTE` | no | Default 120 per session |
| `RATE_LIMIT_FINANCIAL_WRITES_PER_MINUTE` | no | Default 60 per session |
| `NODE_ENV` | set by image | `production` |

**Must never be set in production** (the preflight refuses them): `SEED_DEMO_PASSWORD`, `ASSISTANT_PROVIDER=scripted` and `MFA_ALLOW_DERIVED_KEY`. `SALESFLOW_CONFIG_CHECK=warn` exists for local production-mode testing only.

## 4. Database provisioning

1. **Create the server.** Use managed PostgreSQL 17 with TLS enforced, automated backups and point-in-time recovery, in the same region as the app. Keep it separate from development and test.
2. **Create the roles and the database** (`scripts/db/roles.sql`):
   ```bash
   psql "<admin-url>/postgres?sslmode=require" \
     -v app_password="<from secret store>" -v migrator_password="<from secret store>" \
     -f scripts/db/roles.sql
   ```
   The two roles:
   - `salesflow_migrator` owns the schema and is used only by the release job.
   - `salesflow_app` can read and write rows, with `statement_timeout 30s`, `lock_timeout 10s` and `idle_in_transaction_session_timeout 60s`.

   Some managed providers don't allow `CREATE DATABASE` from SQL. There, create a `salesflow` database owned by the migrator in the console and drop that line.
3. **Apply the grants inside the new database** (`scripts/db/grants.sql`) *before the first migration*:
   ```bash
   psql "<admin-url>/salesflow?sslmode=require" -f scripts/db/grants.sql
   ```
4. **Run migrations** (§6), then create the first administrator (§7).

**Verified locally (Phase 6C)** on a throwaway database:
- As `salesflow_app`, the application works end to end: orders, invoices, payments, reports, user admin, the assistant and the operations summary.
- The same role is refused `DROP TABLE`, `TRUNCATE`, `ALTER TABLE … DISABLE TRIGGER`, `CREATE TABLE` and updates to the audit log.
- Deleting invoices and payments is still refused by the financial triggers.

**Never in production:** `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, `npm run db:seed`, or SQL applied by hand.

## 5. Connection pool sizing

Each instance opens at most `DATABASE_POOL_MAX` connections. The default is 10, with a 30 s idle timeout.

Keep `instances × DATABASE_POOL_MAX + 5 (migrations, admin) < max_connections`. The `salesflow_app` role is also capped at `CONNECTION LIMIT 100`.

| Setup | Pool per instance | Connections |
|---|---|---|
| 1 instance (start here) | 10 | ≤ 10 |
| 2 instances | 10 | ≤ 20 |
| Serverless (Vercel) | 1–3 via a transaction-mode pooler | pooler-bounded |

Connection pressure appears in two places: the admin operations summary (`/api/ops/summary` → `database.connections` vs `maxConnections`), and as `P2024` or pool-timeout errors, which the API reports as `503 DATABASE_UNAVAILABLE`.

## 6. Releases and migrations

Every release runs these steps in order:

1. Build both images from one commit:
   ```bash
   docker build -t salesflow:<sha> .
   docker build -t salesflow-migrate:<sha> --target migrate .
   ```
2. **Back up first** if the release contains migrations. Take a provider snapshot, or run `scripts/db/backup.sh` with a `BACKUP_DATABASE_URL`.
3. Run the migration job once: `salesflow-migrate:<sha>` with `DATABASE_URL=<migrator url>`, which runs `prisma migrate deploy`.
   - It applies only the committed files under `prisma/migrations`, in order, each in a transaction.
   - Each migration is recorded in `_prisma_migrations`.
   - **If it fails, stop the release.** The old version keeps running.
4. Roll out `salesflow:<sha>` with `DATABASE_URL=<app url>`. New instances take traffic only after `/api/health` returns 200.
5. Watch the logs and health for about 15 minutes (§9).

**Migration compatibility (reviewed in Phase 6C).** All migrations are additive and data-preserving (the eleventh, `20261123090000_reference_currencies`, inserts the ALL/EUR/USD reference rows the first production deployment was missing):
- Each one creates tables, columns, indexes, constraints, triggers or functions, and backfills where needed (invoice numbering, billing snapshots and payment attribution in Phase 5).
- None of them drops or rewrites existing business data.

The Phase 6C migration only creates `rate_limit_counters`. Applying the full set to an empty database was tested by the suite on every run. Applying the 6C migration on top of the populated development database was tested with `migrate deploy`, with no drift from `schema.prisma`.

**Rules for future migrations** (expand → migrate → contract):
- Add columns as nullable or with defaults.
- Backfill in the migration.
- Drop old columns only in a later release, once no running version reads them.

This lets the previous app version keep running against the new schema during the rollout and makes app rollbacks safe.

**A failed migration** leaves a row in `_prisma_migrations` with `finished_at` null. `/api/health` then answers 503 `{reason:"migrations"}`, so new instances don't take traffic.

To recover:
1. Read the job log.
2. Fix the data or the migration in a new commit.
3. Run `npx prisma migrate resolve --rolled-back <name>` (migrator URL) and run the job again.

PostgreSQL DDL is transactional, so a failed migration normally leaves nothing half-applied.

## 7. First deployment

1. Provision the database (§4), then run the migration job (§6.3).
2. Start the app with the production variables (§3) and confirm that `GET https://<host>/api/health` returns `{"status":"ok"}`.
3. **Create the first administrator** (there is no seed in production). Run a one-off command with the migrator URL that creates the user with a random temporary password and `must_change_password = true`. For example:
   ```bash
   node -e 'const b=require("bcryptjs");b.hash(process.argv[1],12).then(console.log)' "<temporary password>"
   psql "<migrator url>" -c "INSERT INTO users (id, email, password_hash, role, is_active, must_change_password, updated_at)
     VALUES (gen_random_uuid(), lower('<admin email>'), '<hash>', 'ADMIN', true, true, now())"
   ```
   Sign in, change the password and turn on two-step verification. Create everyone else from **User management** using setup links.
4. Load the real customers, products and employees through the application, not the demo seed.

## 8. Health checks and graceful shutdown

**`GET /api/health`** is public and uncached. It returns 200 `{status:"ok"}` only when all of these hold:
- the instance is not shutting down;
- `SELECT 1` answers within 3 s;
- no migration is in a failed state.

Otherwise it returns 503 with a coarse `reason` of `database`, `migrations` or `shutting_down`. It never includes hostnames or error text.

The Docker `HEALTHCHECK` uses it every 30 s. Point the load balancer's readiness check at it too.

**Startup.** The container first runs `scripts/preflight.mjs`, which exits 1 on configuration errors so the platform shows a failed deploy instead of a broken instance. Then it runs `exec next start`, which serves within about 1 s. Database connections open lazily on the first query, so a database outage at startup doesn't crash the app: health reports 503 until the database is back.

**Shutdown.** On SIGTERM:
1. The instance marks itself as shutting down, and health turns 503 so the load balancer stops routing to it.
2. `next start` stops accepting connections and finishes in-flight requests.
3. The process exits, closing the pool.

Give the platform a **30 s stop timeout** (`docker stop -t 30`, `stopTimeout`, `terminationGracePeriodSeconds`). Every multi-row write is one database transaction, so a killed request leaves nothing half-written.

## 9. Monitoring and logging

**Log format:**
- All application logs go to stdout and stderr.
- Operational events are one JSON line each: `{"level","event",…,"ts"}`.
- Errors are logged as `[scope] {"name","code","message"}`, where the message is one line with credentials, tokens and keys redacted (`src/server/log.ts`).

**Never logged:** passwords, API keys, session cookies or JWTs, MFA secrets, codes or recovery codes, reset tokens, request bodies, questions or answers, and amounts.

| Event | Level | Meaning / suggested alert |
|---|---|---|
| `config_error` / `config_warning` | error/warn | Startup configuration problems |
| `health_failed` `{reason}` | warn | Database unreachable or failed migration: **page** |
| `api_unavailable` `{path,status,code}` | warn | 5xx from the API (e.g. `DATABASE_UNAVAILABLE`, `QUERY_TIMEOUT`): alert if > 5 / 5 min |
| `[api]`, `[next]` error lines | error | Unexpected server errors: alert on any |
| `financial_rejected` `{method,path,status,code}` | warn | Rejected order/invoice/payment writes (overpayment, locked order, validation): watch trends |
| `signin_failed` `{reason}` | warn | Wrong password or MFA code: alert on spikes (> 50 / 15 min) |
| `signin_rate_limited`, `rate_limited` `{limit}` | warn/info | Limits hit: alert on spikes |
| `assistant_answer` `{status,model,toolCalls,inputTokens,outputTokens,estimatedCostUsd,errorCode}` | info/warn | AI usage and cost per answer: alert when `status=error` repeats |
| `shutdown_started` | info | Instance draining |

**Ongoing monitoring:**
- **Uptime check:** poll `/api/health` from outside every minute and alert after 2 failures.
- **Operations summary:** `GET /api/ops/summary` is for administrators only, behind the session and `users.manage`. It returns counts and latencies only:
  - database latency, connections versus maximum, and migration state;
  - sign-ins in the last 24 h, active sessions and locked sign-in keys;
  - assistant questions, errors and estimated spend against the daily cap;
  - security events in the last 24 h.
- **Audit:** security events (sign-ins, MFA, password and role changes, session revocation) are stored append-only in `security_audit_events` and shown under User management → Audit log.
- **Cost:** in-app daily caps, plus a spend limit and usage alerts on the Anthropic key in the Console.

## 10. Rate limiting

Limits work in layers, and every application-level limit is stored in PostgreSQL, so it holds across all instances. None of them uses in-memory counters.

| Layer | What | Limit (default) | Key |
|---|---|---|---|
| Hosting WAF / proxy | All traffic, general `/api/*` reads | e.g. 300 req/min per IP overall and 60 req/min on `/api/auth/*` (generous: a whole office may share one IP) | client IP |
| `auth_login_throttle` | Sign-in per account | 10 failures / 15 min → lock | SHA-256 of email |
| `auth_login_throttle` | MFA codes per user | 5 failures / 15 min → lock | SHA-256 of user |
| `rate_limit_counters` | Failed sign-ins per network | 30 / 15 min (successes never count, so a shared office IP isn't blocked) | SHA-256 of client IP |
| `rate_limit_counters` | Password setup/reset submissions | 10 / hour | SHA-256 of client IP |
| `rate_limit_counters` | API writes per session | 120 / min | SHA-256 of session cookie |
| `rate_limit_counters` | Order, invoice and payment writes per session | 60 / min | SHA-256 of session cookie |
| Assistant admission (advisory lock) | Questions | 1 at a time per user, 10 concurrent, 30 / hour, USD 5 / user / day, USD 50 / day | user |

**Limited responses:**
- Limited requests get `429 RATE_LIMITED` with `Retry-After`.
- The sign-in form shows a "too many attempts from this network" message.
- Per-IP limits apply only when `CLIENT_IP_HEADER` is set, because otherwise any client could choose its own IP.

**Counter storage:**
- Counters are fixed windows: one atomic `INSERT … ON CONFLICT` per check.
- Windows older than 24 h are deleted as the app goes.
- The table holds only hashes.

## 11. Backups and restore

**Primary backups** come from the provider: automated daily backups with point-in-time recovery, retained for at least 7 days (30 days recommended for financial records).

**Logical backups** come from `scripts/db/backup.sh`, which runs `pg_dump --format=custom` and checks the archive. Run it before releases with migrations, and weekly into separate storage, encrypted and in a different account or region:
```bash
BACKUP_DATABASE_URL="<migrator or read-only url>" scripts/db/backup.sh ./backups
```

**Restore drill.** Run it quarterly, and after any schema change, using `scripts/db/restore-check.sh`. It restores into a **new empty** database, refuses a non-empty target, then runs `scripts/verify.sql` (financial integrity) and counts the migrations:
```bash
RESTORE_DATABASE_URL="<scratch database url>" scripts/db/restore-check.sh backups/salesflow-<stamp>.dump
```

**Real restore:**
1. Restore with PITR into a *new* database at the chosen time.
2. Run `restore-check.sh`, or at least `scripts/verify.sql`.
3. Re-apply `scripts/db/grants.sql`.
4. Point `DATABASE_URL` at the restored database and restart the app.
5. Keep the old database for investigation.

**Back up these with the database** (in the secret store, not in the dump): `MFA_ENCRYPTION_KEY`, which enrolled MFA needs, and `AUTH_SECRET`.

## 12. Rollback and incident recovery

| Situation | Action |
|---|---|
| Bad release, no migration | Redeploy the previous image tag. |
| Bad release with an additive migration | Redeploy the previous image; the old code ignores new tables/columns (expand-only rule, §6). Fix forward. |
| Migration failed | Release stops; old version keeps serving. Fix, `prisma migrate resolve --rolled-back`, re-run (§6). |
| Data damaged by a bug | PITR to a new database just before the event (§11), compare, restore or repair; financial history is append-only (invoices are replaced, payments reversed), so most damage is additive and repairable. |
| Database down | Health turns 503, API returns `503 DATABASE_UNAVAILABLE` with `Retry-After`; nothing is half-written. Restore service at the provider; the app reconnects by itself. |
| AI provider outage | The question is answered with `ASSISTANT_UNAVAILABLE` / `ASSISTANT_TIMEOUT` ("The AI service is unavailable right now."); the rest of the app is unaffected. `ASSISTANT_FALLBACKS` stays off unless approved. |
| Suspected credential leak | Rotate the leaked secret: DB password (`ALTER ROLE … PASSWORD`), `ANTHROPIC_API_KEY`, `AUTH_SECRET` (signs everyone out). For an account: admin → revoke sessions, reset password, reset MFA. Review the audit log. |
| `MFA_ENCRYPTION_KEY` lost | Restore it from the secret store backup; otherwise reset MFA for every enrolled user (they re-enrol). |
| Brute-force wave | Check `signin_failed` / `signin_rate_limited` events; tighten WAF limits; the per-account lock and per-IP limit already apply. |

## 13. Capacity and performance

Measurements and query review (Phase 5 benchmarks, plus a Phase 6C index review):

| Area | Behaviour | Capacity note |
|---|---|---|
| Dashboard / reports | Aggregations in SQL; invoiced totals computed per invoice with lateral payment sums; 400 invoices aggregated in < 0.6 s locally | Fine to ~50k invoices; beyond that add summary tables or materialized views |
| Lists and searches | Paginated (max 100 rows); filters use btree indexes (`orders(status, order_date)`, `invoices(status, due_date)`, `customers(assigned_rep_id, status)`…); text search uses `ILIKE '%…%'` | Sequential scans on text search are fine below ~10k rows per table; add `pg_trgm` GIN indexes when customers or products grow past that |
| Order creation | One transaction; numbering under an advisory lock (`0x5f0001`) | Serialized numbering: hundreds of orders/minute, far above need |
| Invoice issuance | One transaction; numbers from a counter table row lock | Same |
| Payments | One transaction; row lock on the invoice; idempotency key unique | Concurrent payments on the same invoice serialize (by design: no overpayment) |
| User admin | Small tables; last-admin check under advisory lock | Negligible |
| AI assistant | Dominated by model latency (5–60 s); bounded rounds and tool calls; admission (a short transaction under an advisory lock) caps concurrency at 10 | Tool queries are short, bounded reads; plan for up to 10 long-lived HTTP requests |
| Rate limiting | One upsert per write request (primary-key lookup) | Sub-millisecond; table stays small (24 h retention) |

**Expected load:** one instance with 1 vCPU and a pool of 10 serves about 50 concurrent staff users comfortably. Add a second instance for availability before adding it for capacity.

**Statement timeout:** 30 s ends runaway queries, which the API reports as `503 QUERY_TIMEOUT`.

## 14. Pre-deployment checklist

- [ ] Production database is separate, with TLS, PITR and backups ≥ 7 days; the restore drill passed once.
- [ ] `salesflow_migrator` and `salesflow_app` created (`roles.sql`, `grants.sql`); the app URL uses `salesflow_app` with `sslmode=require`.
- [ ] Secrets are in the secret store: `DATABASE_URL`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`. `MFA_ENCRYPTION_KEY` and `AUTH_SECRET` are backed up.
- [ ] `AUTH_URL` is the HTTPS origin; `CLIENT_IP_HEADER` matches the proxy; `AUTH_TRUST_HOST` is unset.
- [ ] `SEED_DEMO_PASSWORD`, `ASSISTANT_PROVIDER`, `MFA_ALLOW_DERIVED_KEY` and `SALESFLOW_CONFIG_CHECK` are **not** set.
- [ ] The proxy redirects HTTP→HTTPS, and its idle timeout is ≥ 120 s.
- [ ] WAF limits are configured (§10).
- [ ] The migration job ran: `prisma migrate status` reports up to date.
- [ ] `/api/health` returns 200; the uptime monitor and log alerts (§9) are configured.
- [ ] The first administrator is created, the password changed and MFA enabled; no demo accounts exist.
- [ ] Anthropic key spend limit is set; `ASSISTANT_DAILY_USD_*` is reviewed; `ASSISTANT_FALLBACKS` is off.
- [ ] Stop timeout is 30 s, and the instance count × pool size fits `max_connections`.
- [ ] Verified before release: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test`, `npm run db:verify:guards`, `npm audit --omit=dev`.
- [ ] Rollback plan: the previous image tag is noted and a backup was taken before the migrations.
