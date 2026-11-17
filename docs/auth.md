# Authentication, authorization and business rules (Phase 5A)

The business screens still run on preview fixtures. Sign-in, sessions, roles, page gates and the business-rule endpoints below are real and run against PostgreSQL.

## Authentication

| Piece | Where |
|---|---|
| Auth.js v5 (`next-auth@5.0.0-beta.32`), Credentials provider | `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts` |
| Email/password check (bcrypt cost 12, constant-time for unknown emails, failed-attempt throttle) | `src/server/auth/credentials.ts` |
| Sign-in / sign-out server actions used by the UI | `src/app/actions/auth.ts`, `src/components/auth/login-form.tsx` |
| Per-request session → database lookup (Data Access Layer) | `src/server/auth/session.ts`, `load-principal.ts` |
| Optimistic redirect for requests without a session cookie | `src/proxy.ts` |

- **Sessions** are encrypted JWT cookies (`authjs.session-token`; `__Secure-` prefix over HTTPS). They're httpOnly and SameSite=Lax and carry only the user id. Absolute lifetime is 8 hours, refreshed at most every 15 minutes while in use.
- **Role and status come from the database on every request**, not from the cookie. A disabled user (or disabled employee record) loses access on the next request, and a role change applies immediately.
- **Every failure looks the same.** Unknown email, wrong password and a disabled account all return "Email or password is incorrect, or the account is disabled." The response time doesn't reveal which emails exist.
- **Failed logins are throttled.** After 10 failures for one email within 15 minutes, that email is refused for the rest of the window. The throttle lives in process memory; use a shared store (Redis or a table) once the app runs on more than one instance.
- **No self-registration.** Accounts are created by an administrator; that user-administration UI comes in a later phase.
- **Secrets.** `AUTH_SECRET` and `DATABASE_URL` are server-only, never `NEXT_PUBLIC_`. `.env` is git-ignored, and `.env.example` documents each variable.
- **Seed credentials are for development only.** The four seed accounts share `SEED_DEMO_PASSWORD` (default `ChangeMe-LocalDemo-2026!`), and the seed refuses to run with `NODE_ENV=production`. No password appears in frontend code.

Development logins: `admin@salesflow.test`, `manager@salesflow.test`, `rep.tirana@salesflow.test`, `rep.korce@salesflow.test`.

## Authorization

Three roles only: `ADMIN`, `SALES_MANAGER`, `SALES_REPRESENTATIVE`. There is no accountant role.

1. **Permission matrix:** `src/lib/permissions.ts`, the single source of truth. The UI reads it (`src/lib/roles.ts`) only to decide what to show.
2. **Server checks:**
   - Route handlers and services call `assertPermission(principal, "…")`, which returns 403.
   - Pages call `requirePagePermission("…")`, which redirects to the dashboard.
   - The (app) layout calls `requirePageUser()`, which redirects to `/login`.
3. **Record scope:** `src/server/auth/scope.ts`. A representative sees:
   - customers assigned to them (`Customer.assignedRepId`),
   - orders they sell (`Order.salesRepId`) or that belong to their customers,
   - and those orders' invoices and payments.

   Out-of-scope ids return **404**, so a record's existence isn't confirmed. A representative without an employee record sees nothing.
4. **Database guards** (migrations) are the final authority for money: overpayment, currency, immutability, status transitions and replacement rules.

### Permission matrix

| Permission | Admin | Manager | Rep | Note |
|---|:-:|:-:|:-:|---|
| `users.manage`, `settings.manage` | ✓ | | | |
| `employees.view` | ✓ | ✓ | | |
| `employees.manage` | ✓ | | | |
| `customers.view`, `customers.create`, `customers.update` | ✓ | ✓ | ✓ | Reps: assigned customers only |
| `customers.assign` | ✓ | ✓ | | Change the assigned rep |
| `products.view` | ✓ | ✓ | ✓ | |
| `products.manage`, `categories.manage`, `exchangeRates.manage` | ✓ | ✓ | | |
| `orders.view`, `orders.create`, `orders.update` | ✓ | ✓ | ✓ | Reps: own scope |
| `orders.fulfil` (→ Processing, Delivered) | ✓ | ✓ | ✓ | Reps: own scope |
| `orders.cancel` | ✓ | ✓ | | |
| `prices.override` | ✓ | ✓ | | Unit price ≠ catalogue price at the order rate |
| `invoices.view` | ✓ | ✓ | ✓ | Reps: own scope |
| `invoices.issue`, `invoices.cancel` | ✓ | ✓ | | |
| `payments.view` | ✓ | ✓ | ✓ | Reps: own scope |
| `payments.record` | ✓ | ✓ | | |
| `reports.view`, `assistant.use` | ✓ | ✓ | ✓ | Reps: own scope |

## API (implemented in this phase)

All routes return JSON with `Cache-Control: no-store` and error bodies of the form `{ error: { code, message, details? } }`.
- **Status codes:**
  - 401: not signed in.
  - 403: the role lacks the permission.
  - 404: missing or out of scope.
  - 409: a business rule or concurrency conflict.
  - 415: the request body isn't JSON.
  - 422: validation failed.
  - 503: retries were exhausted.
- **Write requests** must be `application/json` and same-origin; this is the CSRF defence, on top of SameSite=Lax.

| Route | Purpose |
|---|---|
| `GET /api/me` | Current user, role, permissions |
| `GET /api/customers` | Customers in the caller's scope (thin read used to prove scoping) |
| `GET /api/orders/:id` | Order with items **from snapshots** and derived `invoiced` |
| `POST /api/orders/:id/status` | `{ status }` operational transition |
| `POST /api/invoices/:id/cancel` | `{ reason }` |
| `POST /api/invoices/:id/replacement` | `{ issueDate, dueDate }` replacement for a cancelled invoice |
| `POST /api/payments` | `{ invoiceId, amount: "12.34", paymentDate, method, reference?, idempotencyKey }`; 201 new, 200 replay |

The full customer, product, order, invoice and payment modules come later.

## Business rules

- **Roles:** three, as above.
- **Business type:** `CAFE` added. **Address type:** `REGISTERED_OFFICE` added. Both are additive enum values.
- **Order lifecycle** (`src/lib/order-status.ts`, enforced again by the database trigger):
  - DRAFT → CONFIRMED | CANCELLED
  - CONFIRMED → PROCESSING | CANCELLED
  - PROCESSING → DELIVERED | CANCELLED
  - New orders start as DRAFT or CONFIRMED.
- **"Invoiced"** means the order has an ISSUED invoice; it is not a status. An invoiced order can still progress CONFIRMED → PROCESSING → DELIVERED. It can't be cancelled while it has an issued invoice.
- **Financial lock:** once any invoice exists (issued or cancelled), the order's customer, rep, currency, rate, all totals and all items are frozen.
- **Invoice cancellation:**
  - Only an ISSUED invoice with no payments can be cancelled, and a reason is required. `cancelled_at`, `cancellation_reason` and `cancelled_by_id` are recorded, and the row is kept.
  - Cancellation is final: no CANCELLED → ISSUED.
- **Replacement:**
  - Allowed only for a cancelled invoice that hasn't been replaced, on an order that isn't cancelled.
  - It copies the order's locked financial snapshot; only the number (`<original>-R<n>`) and the dates change.
  - At most one ISSUED invoice per order, enforced by a partial unique index.
  - A cancelled invoice can be replaced only once (`replaces_invoice_id` is unique).
  - Correcting *amounts* needs a new order. Credit notes are out of scope.
- **Money:**
  - All calculations use `Prisma.Decimal` with HALF_UP rounding (`src/server/domain/pricing.ts`, `money.ts`).
  - Discount applies before VAT.
  - Payment amounts with more than 2 decimals are **rejected**; floats like `0.1 + 0.2` are refused rather than rounded.
  - Payments are always in the invoice currency.
- **Concurrent payments:**
  - The transaction runs SERIALIZABLE. 40001 and 40P01 errors are retried up to 4 attempts with jittered backoff; every other error is thrown at once.
  - `idempotencyKey` (unique) makes a retried submission return the original payment, even if the first response was lost. Reusing a key for a different payment returns 409.
- **History:** order items render from their snapshots (name, SKU, unit, price, VAT), in both the API and the preview UI.
- **Seed:** orders are dated 3–13 Oct 2026 and invoiced on 15 Oct, with payments on 20 Oct. Rerunning the seed corrects older rows in place.

## Tests

```bash
npm run build      # the HTTP suite runs against the production build
npm test           # unit + database + HTTP (Vitest)
npm run test:db    # unit + database only (no build needed)
npm run db:verify:guards
```

The tests create a separate `salesflow_test` database from the migrations and seed, then drop it at the end. They never touch the development database.
