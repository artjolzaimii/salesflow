# SalesFlow reporting (Phase 5E)

Every dashboard and report figure comes from one service, `src/server/services/reports.ts`, behind `GET /api/reports/*` ([api.md](api.md#reports)). The browser never computes a financial figure; it only formats the decimal strings it receives.

## Metrics

| Metric | Records | Date that places a record in a period | Amount |
|---|---|---|---|
| **Invoiced sales** | Invoices with status `ISSUED` | Invoice **issue date** | Net = `taxable_total` (after discounts, before VAT); VAT = `vat_total`; gross = `total` |
| **Payments collected** | Payments | **Payment date** | `amount` |
| **Outstanding receivables** | `ISSUED` invoices with total − payments > 0 | None: **as of today** (point in time) | total − sum of payments |
| **Overdue receivables** | Outstanding invoices whose due date is before today | None: **as of today** | as outstanding |
| **Order pipeline** | Orders `CONFIRMED`, `PROCESSING` or `DELIVERED` with no `ISSUED` invoice | **Order date** | `grand_total` |
| **Orders (count / by status)** | Orders, all statuses; the KPI excludes `CANCELLED` | **Order date** | count; status breakdown also shows value |
| **Active customers** | Customers with status `ACTIVE` in the caller's scope | None (current) | count; "ordered in this period" counts distinct customers with non-cancelled orders by order date |

Rules that keep these figures honest:
- **Labels:** issued-invoice totals are called **"Invoiced sales"**, not revenue. No accounting-standard revenue recognition is claimed.
- **Orders are not sales.** Order totals only appear as pipeline or order counts, never in invoiced sales.
- **Cancelled invoices never count** as sales; they also owe nothing (outstanding 0).
- **Replacements are counted once.** A cancelled invoice is excluded and its replacement (a new `ISSUED` invoice) counts on its own issue date. Because the replacement copies the same locked snapshot, the sale moves to the replacement's date; it is never counted twice.
- **Reports reflect the current state.** Cancelling an invoice later removes it from the period it was issued in.
- **Payments** can't belong to a cancelled invoice (cancellation is refused once a payment exists), so collections never include amounts on cancelled invoices.

## Dates and periods

All dates are business calendar dates in **Europe/Tirane**, inclusive at both ends (`src/lib/report-period.ts`).

| Preset | Range | Comparison period (dashboard deltas) |
|---|---|---|
| Today | today | yesterday |
| This week | Monday of the ISO week → today | previous Monday → same weekday last week |
| This month | 1st → today | 1st of last month → same day (clamped to the month's end) |
| This year | 1 January → today | 1 January last year → same date last year (29 Feb → 28 Feb) |
| Custom | from → to (≤ 10 years) | the equally long range ending the day before `from` |

- Invoice `issue_date` and payment `payment_date` are `DATE` columns, compared directly.
- `orders.order_date` is stored at the business day's midnight (UTC): a day `d` is `order_date >= d AND order_date < d + 1`.
- The revenue chart shows January → the period's last month of that year; the current month is marked `*` (month to date).
- Trend breakdowns use days for ranges up to 62 days and months beyond.
- **Not period-bound:** outstanding, overdue, aging, the invoice payment-status split and the "recent" lists are as of today.

## Currency

- **ALL is the reporting currency.** An EUR or USD amount is converted with the rate **stored on the record**:
  - invoices (sales, outstanding): `invoices.all_per_unit`,
  - payments: **their invoice's** `all_per_unit` (not a rate on the payment date),
  - pipeline and order values: `orders.all_per_unit`.
- **No current-rate revaluation:** `exchange_rates` is never read by a report. A new rate or a changed product price can't change a historical figure (tested).
- **Rounding:** each record is converted and rounded first, `ROUND(amount × all_per_unit, 2)`, then summed. PostgreSQL `ROUND` rounds half away from zero, which is HALF_UP for these non-negative amounts. All arithmetic is `numeric` (exact decimal); the API returns strings with 2 decimals.
- **Line-level breakdowns** (product, category, top products) convert each order line at its invoice's rate. Their sum can differ from the invoice-level total by a few cents of rounding; this is expected and documented on screen.
- **Single-currency basis** (`ALL`, `EUR`, `USD`): only that currency's records are included, in **original amounts**, with no conversion. The currency breakdown always shows original amounts next to the ALL equivalent.
- Amounts are labelled with their currency everywhere; ALL equivalents are labelled as such.

## Scope

- **Managers and admins:** the whole organisation.
- **Sales representatives:** orders they sold or that belong to customers assigned to them, and those orders' invoices and payments (the same rule as every other module: `orderScopeSql()` in `src/server/auth/scope.ts`, the SQL twin of `orderScope()`).
- **Attribution:** representative performance uses `orders.sales_rep_id`, the representative snapshotted on the order. Reassigning a customer never moves past sales between representatives (tested).
- **Enforcement:** the scope is a condition inside every aggregate query, never a filter on returned rows.

## Implementation and performance

- **Aggregation in PostgreSQL:** sums, counts, groupings and pagination (`COUNT(*) OVER ()`, `LIMIT`/`OFFSET`) run in the database. No report loads all orders, invoices or payments into memory, and there are no per-row follow-up queries.
- **Raw SQL:** reports are written with `Prisma.sql` tagged templates because Prisma's query API can't express grouped sums with per-row currency conversion. Every value is a bound parameter; the only interpolated fragments are fixed constants selected from allowlisted enum values (`groupBy`, `basis`, `period`).
- **Payment sums:** use a per-invoice `LATERAL` lookup on the existing `(invoice_id, payment_date)` index instead of aggregating the whole payments table.
- **Indexes added** (migration `20261119090000_payment_attribution_billing_snapshot`), because the queries need them:
  - `invoices (status, issue_date)`: invoiced sales filter `ISSUED` invoices by issue date.
  - `payments (payment_date)`: collections filter all payments by payment date.
  - Order date ranges reuse the existing `(customer_id, order_date)`, `(sales_rep_id, order_date)` and `(status, order_date)` indexes.
- **Load test:** 400 invoices aggregated exactly, with the sales breakdown and the dashboard served well under the 3 s test limit.

## Audit fields (same migration)

- **`payments.recorded_by_user_id`:** the signed-in user who recorded the payment, set by the payment service.
  - Older payments stay `NULL` and are shown as "Not recorded"; nothing is back-filled.
  - Immutable, because payments can never be updated (trigger).
  - Visible to managers and admins (the roles that record payments); representatives receive `null`.
- **`invoices.billing_address_snapshot`:** business name, NIPT and billing address copied at issue.
  - The address chosen is a BILLING address, then BOTH, then REGISTERED_OFFICE, with the default first. Without one, only the customer's city is recorded.
  - Immutable (`guard_invoice`).
  - A replacement must carry the snapshot of the invoice it replaces (trigger-enforced). A replacement of a pre-snapshot invoice records the billing details at the time it is issued.
  - Older invoices keep `NULL` and show the customer's current address, labelled as such.
