# SalesFlow

Sales management frontend for wholesale and distribution (customers, orders, invoices, payments, reports, AI assistant), migrated from the Claude Design prototype in `design-reference/`.

**Status:**
- **Phase 4** added PostgreSQL and Prisma with migrations, a seed and verified financial guards ([docs/database.md](docs/database.md)).
- **Phase 5A** added Auth.js sign-in against the database, server-side role and ownership checks, the finalised business rules and their endpoints ([docs/auth.md](docs/auth.md)).
- **Phase 5B** connected customers (with contacts and addresses), employees, products, categories and exchange rates to the database through the business APIs ([docs/api.md](docs/api.md)).
- **Phase 5C** connected sales orders: listing, creation, editing before the financial lock, server-side pricing (discount before VAT, HALF_UP), EUR/USD at the stored manual rate, confirmation and operational status changes ([docs/api.md](docs/api.md#orders)).
- **Phase 5D** connected invoices and payments: manual issuance from confirmed orders with internal sequential numbers (`INV-2026-000005`, not fiscalized), cancellation with reason, replacement invoices, derived payment status (unpaid, partial, paid, overdue, cancelled), payment recording with overpayment, currency and precision checks and idempotent retries ([docs/api.md](docs/api.md#invoices)).
- **Phase 5E** connected the dashboard and reports to PostgreSQL through one reporting service (invoiced sales, collections, receivables, overdue, pipeline; ALL at stored rates; Today/Week/Month/Year/Custom periods), and added payment attribution and invoice billing-address snapshots ([docs/reporting.md](docs/reporting.md)).
- **Phase 5F** connected the AI assistant: Claude (official Anthropic SDK, server-side) with read-only, permission-checked tools over the reporting and record services, private persisted conversations, and request, tool, time and cost limits ([docs/assistant.md](docs/assistant.md)). It needs `ANTHROPIC_API_KEY`; without it the screen says it isn't configured.
- **Phase 6A** security audit: server-side session revocation, a shared login throttle, security headers, request limits, safer logging, database-enforced assistant limits and server-computed comparisons ([docs/security.md](docs/security.md)).
- **Phase 6B** user administration (accounts with one-time setup links, roles, activation, resets, sessions), password changes, optional TOTP two-step verification with recovery codes, and a security audit log ([docs/auth.md](docs/auth.md), [docs/api.md](docs/api.md#user-administration-phase-6b)).
- **No preview data remains:** every screen reads the database.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
npm run lint
npx tsc --noEmit

# database (Docker): see docs/database.md
cp .env.example .env          # then set AUTH_SECRET: openssl rand -base64 33
npm run db:up && npm run db:deploy && npm run db:seed
npm run db:verify:guards

# tests (see docs/auth.md)
npm run build && npm test
```

Production deployment (container image, database roles, migrations, health, monitoring, backups, rollback, checklist): see **docs/deployment.md**; the Vercel + Supabase path is **docs/deployment-vercel.md**.

Sign in with a seeded **development** account: `admin@`, `manager@`, `rep.tirana@` or `rep.korce@salesflow.test`. The shared password is `SEED_DEMO_PASSWORD` from `.env`.

The role comes from the session. Loading, empty and error states come from the real API responses.

## Layout

| Path | Contents |
|---|---|
| `design-reference/` | Original prototype (`SalesFlow.dc.html`), its runtime, the Industry design system and `IMPLEMENTATION.md`. Reference only; excluded from lint and type checks. |
| `src/app/` | App Router routes. `(app)/` holds the signed-in shell; `login/` is public. |
| `src/components/ui/` | Design-system primitives: Blueprint frame, Button, Field, StatusBadge, Dialog, Drawer, Pager, list states. |
| `src/components/layout/` | App shell, sidebar, top bar (search, notifications, account), global overlays. |
| `src/components/<domain>/` | Business screens: dashboard, orders, invoices, payments, customers, products, reports, assistant. |
| `src/lib/` | Typed models (`types.ts`), money/VAT/date rules, validation, roles, navigation, invoice status and reporting periods. |
| `src/services/api.ts` | API contract (`SalesFlowApi`) and endpoint list for the future backend. |
| `src/store/` | Client UI state (drawers, dialogs, toast, sidebar) and role flags; no business data. |
| `prisma/`, `prisma.config.ts` | Schema, migrations (incl. financial guards), seed. |
| `scripts/` | Database verification (`verify.sql`, `verify-guards.ts`). |
| `src/auth.ts`, `src/proxy.ts` | Auth.js configuration; optimistic redirect for requests without a session cookie. |
| `src/server/` | Server-only code: Prisma client, auth (credentials, session/DAL, scope), domain (Decimal pricing, money validation), services (customers, employees, catalogue, exchange rates, orders and the shared order-pricing service, invoices, payments, reports, assistant), the assistant's provider adapter and tools (`src/server/assistant/`), HTTP helpers, retry. |
| `src/app/api/` | Route handlers: Auth.js, `/api/me`, customers, employees, products, categories, exchange rates, orders (list, create, quote, edit, confirm, status), invoices (list, detail, issue, cancel, replacement), payments (list, detail, record), reports (dashboard, sales, collections, receivables), assistant (status, conversations, messages). |
| `src/lib/permissions.ts` | Central permission matrix (3 roles), enforced on the server, read by the UI. |
| `src/lib/schemas/` | Zod request schemas shared by the API and the forms. |
| `src/services/client/` | Browser side of the live modules: fetch wrapper with typed errors, query cache, response types derived from the services. |
| `tests/` | Vitest: unit, database (throwaway `salesflow_test`), HTTP and browser (system Chrome via playwright-core) against the production build. |
| `src/styles/industry.css` | Industry design-system component CSS. Tokens live in `src/app/globals.css` (`@theme`). |

## Architecture

Browser → Route Handlers (`src/app/api/`) → services (`src/server/services/`) → Prisma → PostgreSQL. Screens call the routes through `src/services/client/` (fetch wrapper and query cache); the API contract is in `docs/api.md`. `src/lib/roles.ts` derives UI visibility from the permission matrix; the server enforces the same matrix plus record scope (`src/server/auth/`).
