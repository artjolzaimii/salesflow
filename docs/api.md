# SalesFlow API (Phase 5A + 5B)

Request path: browser → Route Handler (`src/app/api/**`) → service (`src/server/services/*`) → Prisma → PostgreSQL. React components never contain business rules; they call these routes through `src/services/client/` (fetch wrapper and a small query cache).

## Conventions

| Topic | Rule |
|---|---|
| Auth | Every route requires an Auth.js session: **401** `UNAUTHENTICATED` without one. Role and active flags are re-read from the database per request. |
| Permissions | Central matrix `src/lib/permissions.ts`: **403** `FORBIDDEN` when the role lacks it. |
| Record scope | Representatives see their assigned customers and those customers' orders, invoices and payments. Anything outside that scope is **404** `NOT_FOUND`, so the record's existence isn't revealed. |
| Validation | Zod schemas in `src/lib/schemas/`, shared with the forms: **422** `VALIDATION_FAILED` with `details: { field: [messages] }` (nested paths such as `contacts.0.phone`). |
| Conflicts | **409**: `DUPLICATE_NIPT`, `DUPLICATE_SKU`, `DUPLICATE_CATEGORY`, `DUPLICATE_EMAIL`, `DUPLICATE_RATE`, `CATEGORY_IN_USE`, `ADDRESS_IN_USE`, `DEFAULT_ADDRESS`, `PRIMARY_CONTACT`, `EMPLOYEE_HAS_CUSTOMERS`, `CANNOT_DEACTIVATE_SELF`, and the financial codes listed in [auth.md](auth.md). |
| Errors | Always `{ error: { code, message, details? } }`. Unexpected errors give **500** `INTERNAL` with no internals exposed. |
| Writes | POST, PATCH and DELETE must come from the same origin. POST and PATCH must be `application/json` (**415** otherwise). Responses carry `Cache-Control: no-store`. |
| Lists | `?page=1&pageSize=25&sort=<field>&dir=asc\|desc&q=<text>` with `pageSize` ≤ 100. `sort` must be one of the endpoint's allowlisted fields (**422** otherwise). The response is `{ items, page, pageSize, total, pages }`. |
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

### Phase 5A routes (unchanged)

`GET /api/me`, `GET /api/orders/:id`, `POST /api/orders/:id/status`, `POST /api/invoices/:id/cancel`, `POST /api/invoices/:id/replacement`, `POST /api/payments`. See [auth.md](auth.md).
