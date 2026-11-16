# SalesFlow

Sales management frontend for wholesale and distribution (customers, orders, invoices, payments, reports, AI assistant), migrated from the Claude Design prototype in `design-reference/`.

**Status:** the UI runs in preview mode on fictional in-memory fixtures (reload resets data). Phase 4 added PostgreSQL + Prisma with migrations, seed and verified financial guards ([docs/database.md](docs/database.md)), but the UI does not read the database yet. No authentication or business APIs exist yet.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
npm run lint
npx tsc --noEmit

# database (Docker): see docs/database.md
cp .env.example .env && npm run db:up && npm run db:deploy && npm run db:seed
npm run db:verify:guards
```

Preview sign-in accepts any valid email and a password of 8+ characters. The sidebar footer has **View as** (rep / manager / accountant / admin) and **Data state** (ready / loading / empty / error) controls, which replace the design tool's Tweaks panel.

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
| `src/server/db.ts` | Server-only Prisma client (not used by the UI yet). |
| `src/styles/industry.css` | Industry design-system component CSS. Tokens live in `src/app/globals.css` (`@theme`). |

## Moving to a real backend

Implement `SalesFlowApi` against the endpoints in `src/services/api.ts` and replace the store's calls to `src/services/preview/operations.ts`. Field names in `src/lib/types.ts` still need confirming against the Prisma schema (see `design-reference/IMPLEMENTATION.md`, "Fields that need schema confirmation"). Permissions shown in `src/lib/roles.ts` only drive UI visibility; the server must enforce them.
