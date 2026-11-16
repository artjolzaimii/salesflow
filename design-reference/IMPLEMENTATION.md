# SalesFlow — design prototype status

`SalesFlow.dc.html` is a clickable design prototype running on **fictional, deterministic fixtures** (preview mode). Nothing is persisted, and no database, Prisma or API is connected. No existing repository was attached, so every contract below is **assumed** and has to be checked against the approved Prisma schema before implementation.

Tweaks: `role` (rep / manager / accountant / admin), `dataState` (ready / loading / empty / error), `startPage`.

## Visual system
Industry design system (steel accent, Barlow Condensed / Barlow, square blueprint frames). It replaces the navy/indigo + Inter direction in the brief. Semantic status colours (success, warning, danger) are muted OKLCH tints that sit alongside the mono accent. All figures use tabular numerals.

## Screens
Built: Login · Dashboard · Orders (list, detail drawer, status transitions) · New order · Invoices (list, detail drawer) · Payments (list, register dialog) · Customers (list, registration form, detail with 6 tabs) · Products (list, create/edit dialog) · Categories · Employees · Reports · AI Assistant.
Placeholders: User management, Settings.

## Assumed API boundaries
| Area | Endpoint | Notes |
|---|---|---|
| Auth | POST /api/auth/login, GET /api/auth/session | Session returns role, used for nav visibility only. The server enforces permissions on every route. |
| Dashboard | GET /api/dashboard/summary?from&to | KPIs and series pre-aggregated in ALL equivalent at invoice rates |
| Customers | GET/POST /api/customers, GET /api/customers/:id | Rep role scoped server-side to assigned customers |
| Products | GET/POST /api/products, PATCH /api/products/:id | Prices stored net of VAT, in ALL |
| Orders | GET/POST /api/orders, POST /api/orders/:id/confirm, /cancel, /invoice | Server computes all totals. The UI preview is advisory. |
| Invoices | GET /api/invoices, GET /api/invoices/:id | Immutable after issue. Payment status derived server-side. |
| Payments | GET/POST /api/payments | Invoice currency only (MVP). Server rejects overpayment. |
| Reports | GET /api/reports/sales?groupBy&from&to&currency | `currency=ALL_EQ` converts at the stored invoice rate |
| Assistant | GET /api/assistant/conversations, POST /api/assistant/conversations/:id/messages | LLM key server-side only. Returns typed result blocks (table, kpis). |

## Fields that need schema confirmation
- Customer: `businessSize`, `addressType`, `municipality`, `notes`
- Customer payment terms: the prototype derives 15 or 30 days from business size
- Order: `exchangeRate` stored per order, `deliveryAddressId`
- Invoice: `rate` snapshot, `dueDate`
- Payment: `method` enum (Bank transfer / Cash / Card), `reference`
- Order status audit log (needed for the timeline)

## Financial rules mirrored in the preview
Per line: net = qty × unit price; discount = net × disc%; taxable = net − discount; VAT = taxable × rate; total = taxable + VAT. Each line is computed in integer cents and rounded half-up, then lines are summed. The backend's rounding policy is authoritative. Values in different currencies are never summed without explicit conversion.
