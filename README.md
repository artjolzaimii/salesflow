# SalesFlow

Sales management frontend for wholesale and distribution (customers, orders, invoices, payments, reports, AI assistant), migrated from the Claude Design prototype in `design-reference/`.

**Status:**
- **Phase 4** added PostgreSQL and Prisma with migrations, a seed and verified financial guards ([docs/database.md](docs/database.md)).
- **Phase 5A** added Auth.js sign-in against the database, server-side role and ownership checks, the finalised business rules and their endpoints ([docs/auth.md](docs/auth.md)).
- **Phase 5B** connected customers (with contacts and addresses), employees, products, categories and exchange rates to the database through the business APIs ([docs/api.md](docs/api.md)).
- **Still preview:** dashboard, orders, invoices, payments, reports and the assistant run on fictional fixtures. Each shows a "Preview data" notice, and a reload resets them.

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

Sign in with a seeded **development** account: `admin@`, `manager@`, `rep.tirana@` or `rep.korce@salesflow.test`. The shared password is `SEED_DEMO_PASSWORD` from `.env`.

The role comes from the session. The sidebar footer keeps a **Data state** control (ready / loading / empty / error) for previewing list states.

## Layout

| Path | Contents |
|---|---|
| `design-reference/` | Original prototype (`SalesFlow.dc.html`), its runtime, the Industry design system and `IMPLEMENTATION.md`. Reference only; excluded from lint and type checks. |
| `src/app/` | App Router routes. `(app)/` holds the signed-in shell; `login/` is public. |
| `src/components/ui/` | Design-system primitives: Blueprint frame, Button, Field, StatusBadge, Dialog, Drawer, Pager, list states. |
| `src/components/layout/` | App shell, sidebar, top bar (search, notifications, account), preview controls, global overlays. |
| `src/components/<domain>/` | Business screens: dashboard, orders, invoices, payments, customers, products, reports, assistant. |
| `src/lib/` | Typed models (`types.ts`), money/VAT/date rules, validation, roles, navigation, analytics aggregations. |
| `src/mocks/` | Fixture data and canned assistant transcripts. The only place business records live. |
| `src/services/api.ts` | API contract (`SalesFlowApi`) and endpoint list for the future backend. |
| `src/services/preview/` | Pure in-memory implementations of the mutations, used by the preview store. |
| `src/store/` | Client store (preview data and UI state) and role-scoped selectors. |
| `prisma/`, `prisma.config.ts` | Schema, migrations (incl. financial guards), seed. |
| `scripts/` | Database verification (`verify.sql`, `verify-guards.ts`). |
| `src/auth.ts`, `src/proxy.ts` | Auth.js configuration; optimistic redirect for requests without a session cookie. |
| `src/server/` | Server-only code: Prisma client, auth (credentials, session/DAL, scope), domain (Decimal pricing, money validation), services (orders, invoices, payments, customers), HTTP helpers, retry. |
| `src/app/api/` | Route handlers: Auth.js, `/api/me`, order status, invoice cancel/replacement, payments, scoped customer list. |
| `src/lib/permissions.ts` | Central permission matrix (3 roles), enforced on the server, read by the UI. |
| `src/lib/schemas/` | Zod request schemas shared by the API and the forms. |
| `src/services/client/` | Browser side of the live modules: fetch wrapper with typed errors, query cache, response types derived from the services. |
| `tests/` | Vitest: unit, database (throwaway `salesflow_test`), HTTP and browser (system Chrome via playwright-core) against the production build. |
| `src/styles/industry.css` | Industry design-system component CSS. Tokens live in `src/app/globals.css` (`@theme`). |

## Moving to a real backend

Implement `SalesFlowApi` against the endpoints in `src/services/api.ts` and replace the store's calls to `src/services/preview/operations.ts`. The frontend↔database field mapping is in `docs/database.md`. `src/lib/roles.ts` derives UI visibility from the permission matrix; the server enforces the same matrix plus record scope (`src/server/auth/`).
