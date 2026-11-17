# SalesFlow security and production readiness (Phase 6A)

Audit of the code as of Phase 5F, the fixes made in Phase 6A, and what production needs. Severity reflects practical exploitability in this application (an internal sales tool with authenticated staff users).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | Sign-out only cleared the browser cookie. Sessions were stateless JWTs, so a copied or stolen cookie stayed valid for up to 8 hours after sign-out, and there was no way to end a session server-side. | **Fixed:** server-side session registry (`auth_sessions`), revoked on sign-out and on deactivation, absolute 8 h lifetime, tokens without a live session refused. |
| 2 | Medium | The login throttle lived in process memory: not shared between instances (an attacker spreads attempts across instances) and unbounded (one map entry per attempted email). | **Fixed:** database throttle with hashed keys, atomic upsert and cleanup. |
| 3 | Medium | The seed fell back to a demo password committed in the repository, and refused only `NODE_ENV=production`. Run by mistake against a hosted database, it would create admin accounts with a public password. | **Fixed:** `SEED_DEMO_PASSWORD` (≥ 12 chars) is required, and non-local databases are refused unless `SEED_ALLOW_REMOTE=true`. |
| 4 | Medium | No security headers (clickjacking, MIME sniffing, no CSP, no HSTS) and an `X-Powered-By` header. | **Fixed:** CSP, `frame-ancestors 'none'` / `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, HSTS; `X-Powered-By` removed. |
| 5 | Medium | AI assistant: the "one question at a time" guard was per instance, there was no cumulative spend cap, and the refusal fallback (which changes the answering model and price) was on by default. | **Fixed:** database-enforced admission (per user, global concurrency, hourly and 24 h spend caps); fallback off unless `ASSISTANT_FALLBACKS=default`. |
| 6 | Medium | AI assistant: the model could do its own arithmetic on financial figures (for example, month-over-month changes). Those figures were only flagged afterwards as unverified. | **Fixed:** `compare_invoiced_sales` computes changes with Decimal on the server; the prompt forbids model arithmetic; post-answer verification stays. |
| 7 | Low | Unhandled errors were logged as whole objects. Prisma validation errors print the full query arguments (for example a password hash on account creation). | **Fixed:** `src/server/log.ts` logs class, code and one redacted line; Prisma arguments are never logged. |
| 8 | Low | No request body limit on JSON APIs. | **Fixed:** 256 KB cap (413 `PAYLOAD_TOO_LARGE`), checked before and after reading. |
| 9 | Low | Cross-site write protection relied on `Origin`, which is absent from some requests. | **Fixed:** `Sec-Fetch-Site: cross-site` is also refused (on top of SameSite=Lax cookies and the JSON-only rule). |
| 10 | Low | No database statement timeout or explicit pool size; no health endpoint. | **Fixed:** `statement_timeout` 30 s, pool max 10 and a connect timeout (all configurable); `GET /api/health`. |
| 11 | Medium (business control) | Any role that may create orders can enter a 0–100 % discount. A representative can confirm a 100 % discount order; the only control is the manager who issues the invoice. | **Open:** needs a business decision on a discount ceiling or approval step. |
| 12 | Medium | No password reset or change flow, no MFA, and no user-administration screen. Admin users without an employee record can't be deactivated from the UI. | **Open:** Phase 6B. |
| 13 | Low | Per-email login lockout lets someone who knows an email lock that account for 15 minutes at a time. | **Accepted trade-off:** add a per-network rate limit at the edge (below). |
| 14 | Low | No general API rate limit (only login and assistant). Authenticated users can run heavy reports repeatedly. | **Mitigated** by the statement timeout, pagination caps and the bounded pool; add edge rate limiting in production. |
| 15 | Low | The CSP allows `'unsafe-inline'` scripts (needed by Next.js bootstrap scripts without nonces). | **Accepted:** React escapes all rendered text; the only `dangerouslySetInnerHTML` uses are static constants (theme script, icons). |
| 16 | Info | Assistant questions and the tool results they need (customer names, amounts) are sent to Anthropic. | **Compliance item:** review the data-processing terms and retention settings before enabling the assistant. |

Reviewed and found sound (no change needed):
- **Passwords:** bcrypt cost 12, with a constant-time path for unknown emails.
- **Authorization:**
  - Every route and service checks permissions on the server.
  - Representative scope is applied inside queries, and out-of-scope records return 404.
  - Assistant conversations are owner-only.
- **SQL:** all raw queries are parameterized `Prisma.sql`; sorting and grouping come only from allowlists.
- **Financial guards:**
  - Invoices and payments are immutable (triggers); invoices are numbered gap-free; one issued invoice per order.
  - Payments are checked for overpayment and currency under a row lock, recorded in SERIALIZABLE transactions with retries and idempotency keys.
  - Amounts are rejected (not rounded) beyond 2 decimals; exchange rates are snapshotted on orders and invoices.
  - Price overrides are restricted to managers; cancellation is blocked with payments; there are no delete paths.
- **Sensitive fields:** password hashes are never selected; idempotency keys and session ids are never returned; payment recorders are shown only to managers and admins.

## Dependencies

`npm audit`:
- **Production dependencies:** 0 vulnerabilities (`npm audit --omit=dev`).
- **Development tooling:** 16 "high" entries, all one advisory, `picomatch` ≤ 4.0.7 (GHSA-fc5q-39xc-vjpf, ReDoS with crafted extglob patterns).
  - **How it is reached:** only through ESLint (`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `picomatch` 2.3.2) and Vitest (`vitest`/`vite`/`tinyglobby` → `picomatch` 4.0.7).
  - **Exploitability:** low. The vulnerable path needs an attacker-controlled glob pattern, but these tools only run on the developer's and CI's own configuration and are never deployed.
  - **No patched release exists:** 4.0.7 is the latest `picomatch`.
  - **npm's suggested "fix" is a downgrade:** `npm audit fix --force` would move `vitest` to 3.1.4 and `eslint-config-next` to 16.3.8, breaking the toolchain.
  - **Action:** none now; update `vitest`, `vite` and `eslint-config-next` normally when `picomatch` publishes a fix.
- **New dependency:** `@anthropic-ai/sdk` is pinned at an exact version.

## Production configuration

**Secrets.** Keep these in the hosting platform's secret store, never in the repository:
- `DATABASE_URL`, `AUTH_SECRET` (≥ 32 random bytes, unique per environment) and `ANTHROPIC_API_KEY`.
- Rotating `AUTH_SECRET` signs everyone out.
- Never set `SEED_DEMO_PASSWORD` in production, and never run the seed there.

**Host and HTTPS:**
- Serve only over HTTPS; HSTS is sent on every response.
- Set `AUTH_URL` to the canonical origin.
- Keep `AUTH_TRUST_HOST=true` only behind a proxy that sets `X-Forwarded-Host` itself (Vercel does); otherwise remove it so a forged Host header can't influence Auth.js URLs.
- Session cookies get the `__Secure-` prefix and the `Secure` flag automatically over HTTPS.

**Database:**
- Use a dedicated application role with DML rights only; migrations run with a separate, more privileged role.
- Size the pool per instance with `DATABASE_POOL_MAX`, so `instances × pool` stays under the server's `max_connections` (or use a pooler such as PgBouncer in transaction mode).
- Keep `DATABASE_STATEMENT_TIMEOUT_MS` (default 30 s).
- Turn on TLS to the database (`sslmode=require` in the URL) and automated backups with point-in-time recovery.

**Migrations:**
- Run `npx prisma migrate deploy` from CI before the new release takes traffic.
- Never run `migrate dev`, `migrate reset` or the seed against production.
- Migrations include triggers and CHECK constraints, so never apply SQL by hand.

**Rate limiting at the edge.** Add per-IP limits in the platform firewall or WAF:
- for example 20 sign-in attempts per IP per 15 minutes on `/api/auth/callback/credentials` and the login page,
- and a general cap on `/api/*`.
The app already limits per email (login) and per user (assistant).

**Health:** point the load balancer or uptime monitor at `GET /api/health`. It returns 200 `{status:"ok"}` or 503, with no details.

**Logging:**
- Server logs contain only scope, error class, code and one redacted line; ship them to a log store with restricted access.
- Don't enable verbose Prisma or query logging in production.

**AI assistant:**
- Set a spend limit on the Anthropic key in the Console in addition to `ASSISTANT_DAILY_USD_*`.
- Keep `ASSISTANT_FALLBACKS=off` unless approved.
- Review data-processing terms (finding 16).

**CORS:** none is configured; the API is same-origin only. Don't add permissive CORS headers.

**Sessions:**
- The `auth_sessions` table keeps revoked and expired rows for at most 7 days per user (cleaned at sign-in).
- To end all sessions of one user, set `revoked_at` for their rows; this is a manual SQL step until the 6B admin screen exists.

## Verification

Regression tests: `tests/http/security-api.test.ts`, the session tests in `tests/http/auth-api.test.ts`, `tests/unit/security.test.ts`, and the Phase 6A block in `tests/db/assistant.test.ts`.
