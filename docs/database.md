# SalesFlow database (Phase 4)

PostgreSQL 17 + Prisma 7.10.1 (`prisma-client` generator, `@prisma/adapter-pg`). Source: the approved `salesflow-db-starter.zip`; its original README is kept as [database-starter-README.md](database-starter-README.md).

The frontend still runs on the preview store. Nothing in `src/app` or `src/components` reads the database yet.

## Setup

```bash
cp .env.example .env          # DATABASE_URL, server-side only, git-ignored
npm install                   # postinstall runs prisma generate
npm run db:up                 # postgres:17 on 127.0.0.1:5433 (5432 is often a local install)
npm run db:deploy             # apply all migrations (use db:migrate while changing the schema)
npm run db:seed               # fictional demo data; repeatable
npm run db:verify             # supplied reconciliation queries (scripts/verify.sql)
npm run db:verify:guards      # full verification incl. guard and concurrency tests
```

Seed login password for all four users: `ChangeMe-LocalDemo-2026!` (local demo only).

## Files

| Path | Purpose |
|---|---|
| `prisma/schema.prisma` | 15 models, 9 enums (approved schema; enums reformatted one value per line, otherwise identical) |
| `prisma/migrations/…_init_salesflow` | Tables, indexes, foreign keys (generated) |
| `prisma/migrations/…_financial_guards` | Approved `financial-guards.sql`, verbatim: 19 CHECK constraints, 4 triggers |
| `prisma/migrations/…_payment_guard_snapshot_safe` | Fix for concurrent overpayment under REPEATABLE READ / SERIALIZABLE (see below) |
| `prisma/migrations/…_payment_attribution_billing_snapshot` | Phase 5E: `payments.recorded_by_user_id`, `invoices.billing_address_snapshot` (immutable via `guard_invoice()`), reporting indexes |
| `prisma/migrations/…_invoice_numbering` | Phase 5D: `invoice_number_counters`, `next_invoice_number()`, `sync_invoice_number_counters()` and the forward-only counter trigger |
| `prisma/seed.ts` | Approved seed (type annotations added so it passes `tsc`; behaviour unchanged) |
| `prisma.config.ts` | Prisma 7 config: schema, migrations path, seed command, datasource URL from env |
| `scripts/verify.sql` | Verification queries: order reconciliation, invoice payment status (as the app derives it), invoice-number counters |
| `scripts/verify-guards.ts` | Relationship, reconciliation, guard and concurrency checks |
| `src/server/db.ts` | Lazy, `server-only` Prisma client for the future API layer |
| `src/generated/prisma/` | Generated client (git-ignored, lint-ignored) |

Financial guards are part of the migration history, so `prisma migrate deploy` applies them everywhere. Never run `financial-guards.sql` by hand. Prisma does not model CHECK constraints or triggers, so they don't appear in `schema.prisma` and don't cause drift.

## Changes from the starter

1. **Enum syntax.** The starter wrote enums on one line (`enum UserRole { ADMIN … }`), which Prisma rejects (P1012, 32 errors). They are now one value per line, with values and order unchanged.
2. **Payment guard concurrency fix** (new migration). `guard_payment()` locked the invoice with `SELECT … FOR UPDATE`. Under REPEATABLE READ a second transaction keeps its old snapshot, doesn't see the first payment, and a merely locked row raises no conflict, so two full payments both committed (outstanding −61.77 USD in the test). The lock is now a no-op `UPDATE` of the invoice row, so a concurrent REPEATABLE READ or SERIALIZABLE payment fails with a serialization error and must retry. READ COMMITTED behaviour is unchanged.
3. **Seed typing.** `products` is typed and the order specs use the starter's own `Line` type instead of `as const`, so the strict TypeScript build passes.
4. **Local port.** Docker maps to `127.0.0.1:5433`.

## Frontend ↔ database mapping

The frontend models (`src/lib/types.ts`) were written before the schema was available. Proposed mappings for the API phase:

| Area | Frontend | Database | Proposed mapping |
|---|---|---|---|
| IDs | Human codes: `C-1001`, `P-001`, `E01`, `SO-2026-0418`, `INV-…`, `PAY-…` | UUID `id`, plus `orderNumber`, `invoiceNumber`, product `sku` | Use UUIDs as `id` and show `orderNumber` / `invoiceNumber` / `sku`. Customers, employees and payments have **no display code**, so decide whether to add `customerCode` / `employeeCode` / `paymentNumber` or show NIPT, name and reference instead. |
| Money | Integer cents (`number`) | `Decimal(18,2)`; unit price `Decimal(18,4)`; quantity `Decimal(18,3)`; rates `Decimal(20,8)` | Send decimals as strings over the API. Unit prices need 4 dp, which the frontend's cents type can't hold. |
| Rounding | Prototype rounds suggested foreign unit prices to 2 dp | Contract: `round4(defaultNetAll / allPerUnit)`, then `round2` per line component | Use one server calculation service; the frontend preview becomes display-only. |
| Exchange rate | `exchangeRate` | `allPerUnit` (orders and invoices), reference `ExchangeRate` table | Rename. Default the new-order rate from the latest `ExchangeRate` instead of hard-coded 97.80 / 91.40. |
| Roles | `rep`, `manager`, `accountant`, `admin` | `SALES_REPRESENTATIVE`, `SALES_MANAGER`, `ADMIN` | **No `ACCOUNTANT` role in the database.** Add the enum value or drop the accountant view. Decision needed. |
| User name | Role config holds name, title, initials | Name lives on `Employee` (`firstName`, `lastName`); `User` has email and role | Read the display name through `user.employee`. |
| Employee | `name`, `region` (territory) | `firstName`, `lastName`, `phone`; no territory | Territory has no column. Add one or drop it from the Employees screen. |
| Customer type | Supermarket, Grocery, Restaurant, Hotel, **Café**, Wholesale | SUPERMARKET, GROCERY, RESTAURANT, HOTEL, WHOLESALER, OTHER | Café has no value: add `CAFE` or map it to `OTHER`. Wholesale maps to WHOLESALER. |
| Customer size | Required; drives payment terms (15/30 days) | `businessSize` optional; no payment-terms column | Make size required in the API, or store payment terms on the customer. The invoice `dueDate` is stored either way. |
| Customer status | `active: boolean` | `ACTIVE`, `INACTIVE`, `BLOCKED` | UI needs a Blocked state. |
| Contact | One embedded contact (`contactName`, `contactPosition`, `phone`, `email`) | `CustomerContact[]` (`fullName`, `jobTitle`, `isPrimary`); customer also has its own email/phone | Show the primary contact; the Contacts tab lists all. |
| Address | One embedded address; types Delivery / Billing / Registered office | `CustomerAddress[]`; types BILLING / DELIVERY / **BOTH** | "Registered office" has no value. Postal code lives on the address. |
| Customer notes | `notes` | none | Add a column or drop the field. |
| Category | `category` name string | `Category` relation with parent tree | Use `categoryId` and show `category.name`. |
| Product | `price`, `vatRate`, `active` | `defaultNetAll`, `vatRate` (Decimal), `isActive` | Rename and convert. |
| Order status | Draft, Confirmed, **Invoiced**, Cancelled | DRAFT, CONFIRMED, PROCESSING, DELIVERED, CANCELLED | "Invoiced" is derived: CONFIRMED with an invoice. PROCESSING and DELIVERED have no UI. |
| Order address | Free-text `deliveryAddress`; "Pickup at warehouse" option | `deliveryAddressId` (FK to the same customer) + `deliverySnapshot` JSON | Pickup = null address plus a snapshot; the snapshot's shape needs defining. |
| Order items | `productId`, `quantity`, `discountPct`, `unitPrice`; name, SKU and VAT read live from the product | Snapshots `productSku`, `productName`, `unit`, `vatRate` and all line amounts | Render items from the snapshot. The current UI reads live product data, which would rewrite history after a product edit. |
| Totals | `net`, `discount`, `taxable`, `vat`, `total` | Orders: `subtotalNet`, `discountTotal`, `taxableTotal`, `vatTotal`, `grandTotal`; invoices: same with `total` | Rename. |
| Invoice | Denormalised `customerId`, `repId`, `paid` | Via `order`; `paid` = sum of payments | Derive server-side. |
| Payment status | Unpaid / Partial / Paid / Overdue (derived) | Stored ISSUED / CANCELLED; derived PAID / PARTIALLY_PAID / OVERDUE (same precedence) | Same rule. A cancelled invoice has no UI state yet. |
| Payment method | Bank transfer, Cash, Card | BANK_TRANSFER, CASH, CARD, OTHER | UI lacks Other. Frontend requires a reference for non-cash payments; the database makes it optional (service rule). |
| Payment number | `PAY-2026-0190` | none (UUID + `reference`) | See IDs. |
| Assistant | Roles user / assistant / error; structured `table` and `kpis`; `fixture` flag | Roles SYSTEM / USER / ASSISTANT / TOOL; `content` text + `toolMetadata` JSON | Store tables and KPIs in `toolMetadata`. An "error" reply is not a stored role; render it client-side or as ASSISTANT with metadata. |
| Dates | ISO date strings | `orderDate` is a timestamp; invoice and payment dates are `DATE` | Format order timestamps in the business time zone. |
| Data | Preview fixtures (14 customers, 10 products, 16 orders) | Seed (5 customers, 6 products, 4 orders, different names) | The two sets diverge on purpose. The UI keeps fixtures until the API phase. |

## Phase 5A changes (migration `20261117090000_business_rules_invoice_replacement`)

Additive only, applied with `prisma migrate deploy`, and no data was lost. Details are in [auth.md](auth.md).

- **Enums:** `BusinessType.CAFE` and `AddressType.REGISTERED_OFFICE`.
- **Order lifecycle trigger:** invoiced orders may move CONFIRMED → PROCESSING → DELIVERED. Money and items stay locked, and an order with an issued invoice can't be cancelled.
- **Invoices:**
  - `order_id` is no longer unique. A partial unique index allows one ISSUED invoice per order.
  - New columns: `cancelled_at`, `cancellation_reason`, `cancelled_by_id`, and `replaces_invoice_id` (unique). A CHECK constraint ties the cancellation fields to the status.
  - Cancellation is final, and a replacement must reference the cancelled invoice of the same order.
- **Payments:** `idempotency_key` (unique) prevents duplicate payments when a request is retried.
- **Unchanged:** `guard_payment()` (snapshot-safe) and every Phase 4 constraint. `db:verify:guards` now runs 61 checks.

Mapping table updates:
- **Accountant role:** dropped. There are three roles.
- **Café:** maps to `CAFE`.
- **Registered office:** maps to `REGISTERED_OFFICE`.
- **Order status:** the UI shows operational statuses (Draft, Confirmed, Processing, Delivered, Cancelled) plus a derived "Invoiced" badge.
- **Order items:** these now render from line snapshots.

## Phase 5B changes (migration `20261117120000_customer_notes_employee_territory`)

There are two nullable, additive columns that the designed screens already showed: `customers.notes` (text) and `employees.territory` (varchar 150). No other schema change was needed for the customer, employee, product, category and exchange-rate modules ([api.md](api.md)).

## Phase 5C (sales orders, no migration)

The order module uses the existing schema; no migration was needed.
- **Pricing:** `src/server/services/order-pricing.ts` is the only place orders are priced (create, edit, quote, confirm). Order and item totals always come from it, never from the request.
- **Exchange rate:** for EUR/USD the rate in effect on the order date (latest `exchange_rates` entry before the end of that day) is copied into `orders.all_per_unit`. New rates never change existing orders. Confirmation refuses a draft whose date now resolves to a different rate (`EXCHANGE_RATE_CHANGED`), so a back-dated correction is reviewed by re-saving.
- **Order numbers:** `SO-<year of order date>-NNN`, continuing the highest existing number, assigned under a transaction-scoped advisory lock so concurrent creates never collide.
- **`deliverySnapshot`:** `{ addressId, label, type, street, city, municipality, postalCode }` copied from the chosen customer address, or `{ pickup: true, label: "Pickup at warehouse" }`. Later address edits never change it.
- **Editing:** DRAFT and CONFIRMED orders that have never been invoiced. The edit replaces the items and re-snapshots product name, SKU, unit and VAT from the catalogue. Once any invoice exists, the database trigger locks money, rate and items regardless.
- **Optimistic concurrency:** edits, confirmation and status changes take the order row lock (`SELECT … FOR UPDATE`) and compare `updated_at` with the version the client loaded; a mismatch is a 409 `CONCURRENT_UPDATE`.

## Phase 5D (invoices and payments, migration `20261118090000_invoice_numbering`)

- **One new table:** `invoice_number_counters (year, last_value)`, modelled as `InvoiceNumberCounter`. No other schema change.
- **`next_invoice_number(year)`** returns `INV-<year>-<6 digits>`. It increments the year's counter with `INSERT … ON CONFLICT DO UPDATE`, which row-locks the counter until the issuing transaction ends. Concurrent issuers therefore queue, a rolled-back issuance gives its number back (no gaps), and a committed number is never handed out again. A trigger only lets counters move forward and forbids deleting them. These are internal SalesFlow numbers, not fiscalized ones.
- **`sync_invoice_number_counters()`** raises each year's counter to the highest `INV-<year>-<n>` already on record. The migration runs it once (the development database's four seeded invoices put 2026 at 4) and the seed runs it after creating its invoices.
- **Issuing** (`src/server/services/invoices.ts`) locks the order row, checks status and existing invoices, allocates the number and inserts the snapshot in one transaction. `guard_invoice()` re-verifies the snapshot, the order status and the one-issued-invoice rule; nothing bypasses it.
- **Payment status** is derived from status, total, payments, due date and today (Europe/Tirane), never stored. The invoice list applies the same rules in SQL so it can filter and sort by status and outstanding balance.
- **Payments** keep the existing guard, SERIALIZABLE transaction with retry, and idempotency key; the service adds clearer pre-checks (outstanding balance, payment date not in the future or before the issue date).

## Phase 5E (reporting, migration `20261119090000_payment_attribution_billing_snapshot`)

- **`payments.recorded_by_user_id`** (nullable FK to `users`, `ON DELETE RESTRICT`): set by the payment service for every new payment. Existing payments stay `NULL`. Immutable because `guard_payment()` refuses every update.
- **`invoices.billing_address_snapshot`** (nullable `jsonb`, CHECK: an object): business name, NIPT and billing address at issue. Existing invoices stay `NULL`. `guard_invoice()` now refuses any change to it, and requires a replacement to carry the replaced invoice's snapshot when that invoice has one. All other guard rules are unchanged.
- **Indexes:** `invoices (status, issue_date)` and `payments (payment_date)` for the reporting date-range aggregations. See [reporting.md](reporting.md).

## Remaining issues and decisions

- **Still open:**
  - Display codes for customers, employees and payments. Screens now show NIPT, name and SKU instead.
  - A "Blocked" customer state in the UI.
  - Payment terms (business size is optional in the database).
- **Correcting amounts after invoicing:** a replacement invoice copies the locked order totals. Fixing an amount needs a new order, because credit notes are out of scope.
- **Invoice numbers:** the four seeded invoices keep their 3-digit numbers (`INV-2026-001`); new ones use 6 digits. Lists sort them naturally. Fiscalization (Albanian e-invoicing) is not integrated.
- **Audit back-fill:** payments recorded and invoices issued before Phase 5E have no recorder and no billing snapshot; none is invented.
- **Database rounding:** `numeric(18,2)` would still round sub-cent input. The payment service rejects it first, and every future write path must use the same validation (`src/server/domain/money.ts`).
- **Service-layer rules for later phases:**
  - A status history table (the order drawer's timeline shows reached steps, not their dates).
  - A discount ceiling for representatives, if the business wants one (any role that may create orders can enter 0–100 %).
