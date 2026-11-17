# SalesFlow API (Phase 5A–5D)

Request path: browser → Route Handler (`src/app/api/**`) → service (`src/server/services/*`) → Prisma → PostgreSQL. React components never contain business rules; they call these routes through `src/services/client/` (fetch wrapper and a small query cache).

## Conventions

| Topic | Rule |
|---|---|
| Auth | Every route requires an Auth.js session: **401** `UNAUTHENTICATED` without one. Role and active flags are re-read from the database per request. |
| Permissions | Central matrix `src/lib/permissions.ts`: **403** `FORBIDDEN` when the role lacks it. |
| Record scope | Representatives see their assigned customers and those customers' orders, invoices and payments. Anything outside that scope is **404** `NOT_FOUND`, so the record's existence isn't revealed. |
| Validation | Zod schemas in `src/lib/schemas/`, shared with the forms: **422** `VALIDATION_FAILED` with `details: { field: [messages] }`, keyed by the full path (`contacts.0.phone`, `lines.2.quantity`). |
| Conflicts | **409**: `NO_EXCHANGE_RATE`, `EXCHANGE_RATE_CHANGED`, `CUSTOMER_NOT_ACTIVE`, `ORDER_NOT_EDITABLE`, `ORDER_FINANCIALLY_LOCKED`, `INVALID_STATUS_TRANSITION`, `CONCURRENT_UPDATE`, `DUPLICATE_NIPT`, `DUPLICATE_SKU`, `DUPLICATE_CATEGORY`, `DUPLICATE_EMAIL`, `DUPLICATE_RATE`, `CATEGORY_IN_USE`, `ADDRESS_IN_USE`, `DEFAULT_ADDRESS`, `PRIMARY_CONTACT`, `EMPLOYEE_HAS_CUSTOMERS`, `CANNOT_DEACTIVATE_SELF`, `ORDER_NOT_INVOICEABLE`, `ORDER_ALREADY_INVOICED`, `REPLACEMENT_REQUIRED`, `INVOICE_NOT_CANCELLED`, `ALREADY_REPLACED`, `INVOICE_CANCELLED`, `INVOICE_HAS_PAYMENTS`, `INVOICE_NOT_PAYABLE`, `OVERPAYMENT`, `IDEMPOTENCY_KEY_REUSED`, and the other financial codes listed in [auth.md](auth.md). |
| Errors | Always `{ error: { code, message, details? } }`. Unexpected errors give **500** `INTERNAL` with no internals exposed. |
| Writes | POST, PATCH and DELETE must come from the same origin. POST and PATCH must be `application/json` (**415** otherwise). Responses carry `Cache-Control: no-store`. |
| Lists | `?page=1&pageSize=25&sort=<field>&dir=asc\|desc&q=<text>` with `pageSize` ≤ 100. `sort` must be one of the endpoint's allowlisted fields (**422** otherwise). The response is `{ items, page, pageSize, total, pages }`; invoice and payment lists add per-currency `totals` over the whole filtered set. |
| Money | Exact decimal strings, never floats: product prices have 4 dp, amounts 2 dp, rates up to 8 dp. Inputs with more decimals than allowed are rejected, not rounded. |
| Ids | UUIDs. A malformed id in the path is a 404. |
| Sensitive fields | Password hashes are never selected. Employee responses expose only `email`, `role` and `isActive` of the linked user. |
| Transactions | Multi-record writes run in one transaction: a customer with its contacts and addresses; employee + login account; deactivation + reassignment; primary/default switches. |

## Endpoints

### Customers

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/customers` | `customers.view` (scoped) | Filters `q` (name, NIPT, city), `status`, `businessType`, `businessSize`, `city`, `repId`. Sort: `businessName`, `nipt`, `city`, `registeredAt`, `status` |
| `POST /api/customers` | `customers.create` | Body includes `contacts[]` (≥1) and `addresses[]` (≥1). NIPT is normalised (spaces removed, upper case) and checked against `^[A-Z]\d{8}[A-Z]$`, then for uniqueness. Reps are always assigned to themselves; only managers set another rep or `BLOCKED`. |
| `GET /api/customers/:id` | `customers.view` (scoped) | Contacts, addresses (with `usedByOrders`), and a read-only history: orders, invoices with paid/outstanding, payments, and per-currency summary |
| `PATCH /api/customers/:id` | `customers.update` (scoped) | Any business field, status, notes. `assignedRepId` and `BLOCKED` need `customers.assign`. Customers are never deleted; set them `INACTIVE`. |
| `POST /api/customers/:id/contacts` | `customers.update` (scoped) | Exactly one primary contact is kept. |
| `PATCH`/`DELETE /api/customers/:id/contacts/:contactId` | `customers.update` (scoped) | The primary contact can't be removed or un-primaried directly. |
| `POST /api/customers/:id/addresses` | `customers.update` (scoped) | Exactly one default address is kept. |
| `PATCH`/`DELETE /api/customers/:id/addresses/:addressId` | `customers.update` (scoped) | You can't delete the default address or one that orders were delivered to. Edits never change order `deliverySnapshot`s. |

### Employees

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/employees` | `employees.view` | Filters `q`, `active`, `role`. Includes customer count and month-to-date orders and net invoiced (ALL at each invoice's stored rate). |
| `GET /api/employees/:id` | `employees.view` | Assigned customers, login (email, role, active). |
| `POST /api/employees` | `employees.manage` | Optional `account: { email, role, password ≥ 12 }`, which needs `users.manage`. bcrypt cost 12; the password is never returned. |
| `PATCH /api/employees/:id` | `employees.manage` | Names, phone, territory, `isActive`. To deactivate someone with customers, include `reassignCustomersTo`. You can't deactivate yourself. Deactivation blocks sign-in on the next request. |
| `POST /api/employees/:id/reassign` | `customers.assign` | `{ toEmployeeId, customerIds? }`. Past orders keep their original sales rep. |

### Products and categories

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/products` | `products.view` | Filters `q` (name, SKU), `categoryId`, `active`. Sort: `name`, `sku`, `defaultNetAll`, `createdAt`, `updatedAt`. |
| `POST /api/products` | `products.manage` | SKU is upper-cased and unique. `defaultNetAll` is net ALL excluding VAT, with ≤ 4 dp. `vatRate` is 20, 10, 6 or 0. |
| `GET`/`PATCH /api/products/:id` | `products.view` / `products.manage` | Use `isActive: false` to deactivate (order lines keep referencing the product). Order-item snapshots never change. |
| `GET /api/categories` | `products.view` | Product and active counts, plus the units in use. |
| `POST /api/categories`, `PATCH`/`DELETE /api/categories/:id` | `categories.manage` | Names are unique and nesting can't form a cycle. Only empty categories can be deleted. |

### Exchange rates

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/exchange-rates` | `exchangeRates.view` (all roles) | History (`?currency=EUR\|USD`) plus `current`: the latest rate effective now for each currency. ALL is always 1. |
| `POST /api/exchange-rates` | `exchangeRates.manage` | `{ currencyCode: EUR\|USD, allPerUnit, effectiveAt }` means 1 unit = X ALL, entered manually only. The table is append-only, so a correction is a new entry. Orders and invoices keep their own `all_per_unit`. |
| `GET /api/exchange-rates/applicable?currency=EUR&date=YYYY-MM-DD` | `exchangeRates.view` | The rate an order on that date would store, or `rate: null` with the reason. |

### Orders

Pricing happens only on the server, in `src/server/services/order-pricing.ts` (create, edit, quote and confirm all use it). Requests carry quantities, discounts and optional unit prices; any totals in the body are ignored.

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/orders` | `orders.view` (scoped) | Filters `q` (order number, customer name, NIPT), `status` (`DRAFT`…`CANCELLED`, or `INVOICED` = has an issued invoice), `currency`, `customerId`, `repId`, `from`, `to`. Sort: `orderDate` (default, desc), `orderNumber`, `grandTotal`, `status`, `createdAt`. |
| `POST /api/orders` | `orders.create` (+ `orders.update` for `status: "CONFIRMED"`) | Body `{ customerId, salesRepId?, orderDate, currencyCode, deliveryAddressId?, lines: [{ productId, quantity, unitNetPrice?, discountPercent? }], status? }`. 201 with the order as `GET /api/orders/:id` returns it. |
| `POST /api/orders/quote` | `orders.create` (`orders.update` with `orderId`) | Same body (plus `orderId` when editing); returns server-priced lines and totals without saving. The form shows these as "Confirmed by server". |
| `GET /api/orders/:id` | `orders.view` (scoped) | Items from the line snapshots, totals, stored rate, delivery snapshot, `version`, `editable`, `financiallyLocked`, and `actions` the caller may take. |
| `PATCH /api/orders/:id` | `orders.update` (scoped) | Full body plus `version`. DRAFT or CONFIRMED and never invoiced; everything is re-priced. A stale `version` is 409 `CONCURRENT_UPDATE`. |
| `POST /api/orders/:id/confirm` | `orders.update` (scoped) | `{ version? }`. DRAFT → CONFIRMED after re-checking the customer is active, there is at least one line and the date's rate is still the stored one. Totals are recomputed from the lines. |
| `POST /api/orders/:id/status` | per target (scoped) | `{ status, version? }`: `CONFIRMED` (same as `/confirm`), `PROCESSING`/`DELIVERED` (`orders.fulfil`), `CANCELLED` (`orders.cancel`, not with an issued invoice). Never changes amounts. |

Rules:
- **Lines:** quantity > 0 with ≤ 3 decimals; unit price ≥ 0 with ≤ 4 decimals; discount 0–100 with ≤ 2 decimals; 1–200 lines; products must be active (an existing line may keep a since-deactivated product).
- **Price:** omit `unitNetPrice` for the catalogue price, `round4(defaultNetAll / rate)`. Any other value is an override and needs `prices.override` (403 `PRICE_OVERRIDE_FORBIDDEN` with the line in `details`). An override already on the order survives an edit by a representative if the line (`id`), product and price are unchanged at the same rate.
- **Money:** per line `gross = round2(qty × price)`, `discount = round2(gross × % / 100)`, `taxable = gross − discount`, `VAT = round2(taxable × rate / 100)`; totals are sums of the rounded lines. Decimal arithmetic, HALF_UP.
- **Currency:** ALL at 1; EUR/USD at the manual rate in effect on the order date, stored on the order. With no such rate the order can't be saved or confirmed (409 `NO_EXCHANGE_RATE`, message explains where to add one).
- **Attribution:** representatives order only for their assigned customers and are always the order's sales rep; managers and admins pick any active employee (default: the customer's rep). Reassigning the customer later never changes `salesRepId`.
- **Date:** the order date can't be in the future (Europe/Tirane).
- **Customer:** must be ACTIVE to create, edit or confirm.

### Invoices

Issued manually from an order; confirming an order never issues one. The invoice copies the order's snapshot (currency, stored rate, net, discounts, VAT, total) and is never recalculated from current prices or rates. The `invoice_guard` trigger refuses any insert that differs from the order, and any later change to the snapshot.

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/invoices` | `invoices.view` (scoped) | Filters `q` (invoice number, order number, customer, NIPT), `status` (`OPEN`, `UNPAID`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `CANCELLED`), `currency`, `customerId`, `orderId`, `from`/`to` (issue date). Sort: `issueDate` (default, desc), `dueDate`, `invoiceNumber` (natural order), `total`, `outstanding`, `createdAt`. Rows carry `paid`, `outstanding`, `paymentStatus`, `overdue`, `daysOverdue`. |
| `POST /api/invoices` | `invoices.issue` | `{ orderId, dueDate, version? }`, nothing else (strict: client totals or an issue date are **422**). Order must be CONFIRMED, PROCESSING or DELIVERED with no invoice yet. Issue date = today (Europe/Tirane); due date today … +366 days. 201 with the invoice as `GET /api/invoices/:id` returns it. |
| `GET /api/invoices/:id` | `invoices.view` (scoped) | Totals, stored rate, ALL equivalent, the order's item snapshot, payment history with balance after each payment, cancellation (who, when, why), `replaces`/`replacedBy`, derived status, `actions`. |
| `POST /api/invoices/:id/cancel` | `invoices.cancel` (scoped) | `{ reason }` (3–500 chars). ISSUED invoices without payments only. The record and its number stay; cancellation is final. |
| `POST /api/invoices/:id/replacement` | `invoices.issue` (scoped) | `{ dueDate }`. For a CANCELLED, not yet replaced invoice whose order has no ISSUED invoice and is not cancelled. New number, same snapshot, `replacesInvoiceId` link. 201. |

Rules:
- **One active invoice per order:** the partial unique index `invoices_one_issued_per_order` and the guard trigger. Issuing locks the order row (`SELECT … FOR UPDATE`) first, so concurrent requests for one order give one 201 and 409 `ORDER_ALREADY_INVOICED` for the rest. After a cancellation, `POST /api/invoices` answers 409 `REPLACEMENT_REQUIRED`; the order is re-invoiced through `/replacement`.
- **Numbers:** `INV-<issue year>-<000001>`, internal SalesFlow identifiers (not fiscalized; no fiscalization service is called). Allocated by `next_invoice_number(year)` inside the issuing transaction: concurrent issuers queue on the counter row, a rolled-back issuance releases its number, numbers are never reused, and cancelled invoices keep theirs. The four seeded invoices keep their original `INV-2026-001…004`; new numbers continue at `INV-2026-000005`.
- **Payment status** (derived, never stored; `src/lib/invoice-status.ts`): `CANCELLED`; `PAID` when payments cover the total; `PARTIALLY_PAID`; `UNPAID`. `overdue` is a separate flag (open balance and due date before today), so an overdue, partially paid invoice is both. Outstanding = total − payments (0 for cancelled).
- **Stale order:** a `version` that no longer matches the order is 409 `CONCURRENT_UPDATE`.

### Payments

| Method & path | Permission | Notes |
|---|---|---|
| `GET /api/payments` | `payments.view` (scoped) | Filters `q` (reference, invoice number, customer, NIPT), `method`, `currency`, `invoiceId`, `customerId`, `from`/`to` (payment date). Sort: `paymentDate` (default, desc), `amount`, `createdAt`. |
| `GET /api/payments/:id` | `payments.view` (scoped) | The payment, its invoice (with current paid/outstanding/status), and the invoice balance before and after it. |
| `POST /api/payments` | `payments.record` | `{ invoiceId, amount, paymentDate, method: CASH\|BANK_TRANSFER\|CARD\|OTHER, reference?, currencyCode?, idempotencyKey }`. 201 new, 200 replay. |

Rules:
- **Currency:** always the invoice currency; a different `currencyCode` is 422 with `details.currencyCode`.
- **Amount:** positive, at most 2 decimals (`10.005` is 422, never rounded), not above the outstanding balance (409 `OVERPAYMENT` with `details.amount`). The `payment_guard` trigger re-checks this under a lock on the invoice row; the transaction is SERIALIZABLE with bounded retries.
- **Date:** not in the future and not before the invoice's issue date.
- **Reference:** required for every method except cash (≤ 120 chars).
- **Idempotency:** one key per submission. The same key with the same invoice and amount returns the original payment; with anything else it is 409 `IDEMPOTENCY_KEY_REUSED`. The payment form keeps its key across network failures and starts a new one after any server answer.
- **Immutability:** payments can't be edited or deleted (trigger).

### Phase 5A routes

`GET /api/me`. See [auth.md](auth.md).
