# SalesFlow database starter

This bundle contains the complete 15-entity Prisma schema, Prisma 7-style configuration, fictional demo seed, PostgreSQL safety triggers, and verification queries. No frontend is included.

## Install (Node 22 LTS or newer; Docker Desktop)

Create a Next.js project in an empty directory first, then copy this bundle's `prisma/`, `scripts/`, `prisma.config.ts`, `.env.example`, and `docker-compose.yml` into the project root.

```bash
npx create-next-app@latest salesflow --typescript --tailwind --eslint --app --src-dir --import-alias '@/*'
cd salesflow
npm install @prisma/client @prisma/adapter-pg pg dotenv bcryptjs
npm install -D prisma tsx @types/pg
cp .env.example .env
docker compose up -d
npx prisma validate
npx prisma migrate dev --name init_salesflow
npx prisma generate
docker compose exec -T postgres psql -U salesflow -d salesflow < prisma/financial-guards.sql
npx prisma db seed
npx prisma studio
docker compose exec -T postgres psql -U salesflow -d salesflow < scripts/verify.sql
```

**Important:** `financial-guards.sql` is a post-migration development step, not automatically tracked by Prisma Migrate. Before deploying, put its SQL into a separate checked-in migration (`npx prisma migrate dev --create-only --name financial_guards`, insert SQL into generated migration.sql, then apply), and use `prisma migrate deploy` in production. Do not apply the guards twice.

Seed user password: `ChangeMe-LocalDemo-2026!` (LOCAL DEMO ONLY). Rates, customers, and NIPTs are invented; VAT=0 product is an illustrative test case, not a claim about Albanian tax classification. Seed is designed to be repeatable.

## Calculation contract

All values are `Prisma.Decimal`. `allPerUnit` means ALL for 1 unit of order currency. Suggested net unit price = `product.defaultNetAll / order.allPerUnit`, rounded to 4 decimals HALF_UP. Override price is already in transaction currency. For each line: `grossNet = round2(quantity * unitNetPrice)`; `discountAmount = round2(grossNet * discountPercent / 100)`; `taxableAmount = grossNet - discountAmount`; `vatAmount = round2(taxableAmount * vatRate / 100)`; `lineTotal = taxableAmount + vatAmount`. Order totals are the exact sum of rounded line components. Currency minor units are 2 for the MVP. Persist the calculation algorithm in one service, and test boundary rounding cases. Reporting conversion = `invoice.total * invoice.allPerUnit` with explicit reporting rounding policy, not sum of unlike currencies.

## Integrity notes / remaining service responsibilities

- Invoice statuses stored: `ISSUED`, `CANCELLED`. `PAID`, `PARTIALLY_PAID`, `OVERDUE` are **derived** in queries from the payment sum and due date (overdue has priority). This avoids stale states.
- The invoice trigger locks its order, validates confirmed status, and compares totals. Payment trigger locks the invoice row before checking aggregate payments; concurrent inserts for the same invoice serialize. DB constraints reject non-positive payments and invalid amounts.
- The trigger prohibits payment update/deletion and invoice deletion. Refunds, reversals, credit notes, and fiscalized invoicing are **out of scope**.
- Do not edit an order's items after invoice issuance. Service layer must also prevent financial changes after order confirmation, unless a deliberate amendment workflow is designed.
- Customer delivery address is constrained to the same customer through a composite FK. `deliverySnapshot` must be populated on confirmation; the DB does not validate its JSON shape.
- Employee role eligibility, ownership checks, case-insensitive email/NIPT normalization, order number sequencing, product price override permission, and rate approval must be implemented in services. `Employee` is not necessarily a sales rep; enforce role eligibility on assignment.
- DB checks validate line arithmetic identities but **do not independently recompute rounding from quantity and rates**. Backend calculation service is authoritative; verify with unit tests.
- Reference exchange rates are manually entered; orders store independent rate snapshots. Rate records are not an authoritative external feed.
- Historical invoices preserve financial totals, but the MVP does not snapshot complete legal invoice parties and line-level invoice details separately. Order-item snapshots and customer/address snapshots cover demonstration, not legally compliant invoice issuance.
- The current SQL guards prevent invoiced order financial updates but permit `deliverySnapshot` edits; freeze all invoice-related presentation fields in services or extend trigger for full immutability.
- `AIMessage` is a persisted conversation transcript, not permission to trust previous tool output. Reauthorize every tool call.
- Production hardening: normalize identifiers, add password/login rate limiting, audit logging, backup strategy, tests, and deployment secrets.
