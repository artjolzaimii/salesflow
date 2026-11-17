/**
 * SalesFlow database verification.
 *
 *   npm run db:verify:guards
 *
 * Part 1 (read-only, development database): relationships and financial
 * reconciliation, including an independent recomputation of every order line.
 *
 * Part 2 (throwaway database): negative tests for every financial guard and
 * concurrent payment attempts at each isolation level. Payments cannot be
 * deleted by design, so these tests run in a scratch database built from the
 * same migrations and seed, which is dropped afterwards.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { Client } from "pg";

const MAIN_URL = process.env.DATABASE_URL;
if (!MAIN_URL) throw new Error("DATABASE_URL is not set (copy .env.example to .env).");

const SCRATCH_DB = "salesflow_guardtest";
const scratchUrl = (() => {
  const u = new URL(MAIN_URL);
  u.pathname = "/" + SCRATCH_DB;
  return u.toString();
})();
const adminUrl = (() => {
  const u = new URL(MAIN_URL);
  u.pathname = "/postgres";
  u.search = "";
  return u.toString();
})();

let failures = 0;
const pass = (name: string, detail = "") => console.log(`  PASS  ${name}${detail ? "  — " + detail : ""}`);
const fail = (name: string, detail = "") => {
  failures++;
  console.log(`  FAIL  ${name}${detail ? "  — " + detail : ""}`);
};
const check = (name: string, ok: boolean, detail = "") => (ok ? pass(name, detail) : fail(name, detail));

async function connect(url: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  return c;
}

/** Query returning rows that violate an invariant; the check passes when none come back. */
async function none(db: Client, name: string, sql: string) {
  const { rows } = await db.query(sql);
  check(name, rows.length === 0, rows.length ? `${rows.length} violation(s): ${JSON.stringify(rows.slice(0, 3))}` : "");
}

/** Runs a statement inside a savepoint and expects PostgreSQL to reject it. */
async function rejects(db: Client, name: string, sql: string, params: unknown[] = [], expect?: RegExp) {
  await db.query("SAVEPOINT t");
  try {
    await db.query(sql, params);
    fail(name, "statement was accepted");
  } catch (e) {
    const msg = (e as Error).message;
    if (expect && !expect.test(msg)) fail(name, `rejected for the wrong reason: ${msg}`);
    else pass(name, msg);
  } finally {
    await db.query("ROLLBACK TO SAVEPOINT t");
  }
}

/* ------------------------------------------------------------------ */

async function verifyDevelopmentDatabase() {
  console.log("\n1. Relationships and reconciliation (development database)");
  const db = await connect(MAIN_URL!);
  try {
    const { rows: [counts] } = await db.query(`
      SELECT (SELECT count(*) FROM users)::int users,
             (SELECT count(*) FROM employees)::int employees,
             (SELECT count(*) FROM customers)::int customers,
             (SELECT count(*) FROM customer_contacts)::int contacts,
             (SELECT count(*) FROM customer_addresses)::int addresses,
             (SELECT count(*) FROM categories)::int categories,
             (SELECT count(*) FROM products)::int products,
             (SELECT count(*) FROM currencies)::int currencies,
             (SELECT count(*) FROM exchange_rates)::int exchange_rates,
             (SELECT count(*) FROM orders)::int orders,
             (SELECT count(*) FROM order_items)::int order_items,
             (SELECT count(*) FROM invoices)::int invoices,
             (SELECT count(*) FROM payments)::int payments,
             (SELECT count(*) FROM ai_conversations)::int ai_conversations,
             (SELECT count(*) FROM ai_messages)::int ai_messages`);
    console.log("  counts:", JSON.stringify(counts));

    // Relationships
    await none(db, "every user has exactly one employee", `SELECT u.email FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE e.id IS NULL`);
    await none(db, "every customer is assigned to an existing, active employee", `SELECT c.business_name FROM customers c LEFT JOIN employees e ON e.id = c.assigned_rep_id WHERE e.id IS NULL OR NOT e.is_active`);
    await none(db, "every customer has a primary contact and a default address", `
      SELECT c.business_name FROM customers c
      WHERE NOT EXISTS (SELECT 1 FROM customer_contacts x WHERE x.customer_id = c.id AND x.is_primary)
         OR NOT EXISTS (SELECT 1 FROM customer_addresses a WHERE a.customer_id = c.id AND a.is_default)`);
    await none(db, "every order belongs to a customer and its delivery address belongs to that customer", `
      SELECT o.order_number FROM orders o JOIN customers c ON c.id = o.customer_id
      LEFT JOIN customer_addresses a ON a.id = o.delivery_address_id
      WHERE o.delivery_address_id IS NOT NULL AND (a.id IS NULL OR a.customer_id <> o.customer_id)`);
    await none(db, "order sales rep is the customer's assigned rep", `SELECT o.order_number FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.sales_rep_id <> c.assigned_rep_id`);
    await none(db, "every order has at least one item", `SELECT o.order_number FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)`);
    await none(db, "every product has a category", `SELECT p.sku FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE c.id IS NULL`);
    await none(db, "order item snapshots match the product at seed time", `
      SELECT i.product_sku FROM order_items i JOIN products p ON p.id = i.product_id
      WHERE i.product_sku <> p.sku OR i.product_name <> p.name OR i.unit <> p.unit OR i.vat_rate <> p.vat_rate`);
    await none(db, "each invoice belongs to exactly one confirmed order (1:1)", `
      SELECT i.invoice_number FROM invoices i JOIN orders o ON o.id = i.order_id WHERE o.status <> 'CONFIRMED'
      UNION ALL SELECT order_id::text FROM invoices GROUP BY order_id HAVING count(*) > 1`);
    await none(db, "every payment references an invoice in the same currency", `SELECT p.reference FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.currency_code <> i.currency_code`);
    await none(db, "every AI conversation belongs to a user and has messages", `
      SELECT c.title FROM ai_conversations c LEFT JOIN users u ON u.id = c.user_id
      WHERE u.id IS NULL OR NOT EXISTS (SELECT 1 FROM ai_messages m WHERE m.conversation_id = c.id)`);

    // Financial reconciliation
    await none(db, "order totals reconcile with item sums (all five components)", `
      SELECT o.order_number FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY o.id
      HAVING sum(i.gross_net) <> o.subtotal_net OR sum(i.discount_amount) <> o.discount_total
          OR sum(i.taxable_amount) <> o.taxable_total OR sum(i.vat_amount) <> o.vat_total OR sum(i.line_total) <> o.grand_total`);
    await none(db, "every line recomputes independently (round2, HALF_UP)", `
      SELECT product_sku, quantity, unit_net_price, gross_net, discount_amount, vat_amount FROM order_items
      WHERE gross_net <> round(quantity * unit_net_price, 2)
         OR discount_amount <> round(gross_net * discount_percent / 100, 2)
         OR taxable_amount <> gross_net - discount_amount
         OR vat_amount <> round(taxable_amount * vat_rate / 100, 2)
         OR line_total <> taxable_amount + vat_amount`);
    await none(db, "unit prices derive from the product price and the stored order rate (4 dp)", `
      SELECT i.product_sku, i.unit_net_price, round(p.default_net_all / o.all_per_unit, 4) expected
      FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
      WHERE i.unit_net_price <> round(p.default_net_all / o.all_per_unit, 4)`);
    await none(db, "invoices snapshot their order's currency, rate and totals", `
      SELECT i.invoice_number FROM invoices i JOIN orders o ON o.id = i.order_id
      WHERE (i.currency_code, i.all_per_unit, i.subtotal_net, i.discount_total, i.taxable_total, i.vat_total, i.total)
         IS DISTINCT FROM (o.currency_code, o.all_per_unit, o.subtotal_net, o.discount_total, o.taxable_total, o.vat_total, o.grand_total)`);
    await none(db, "ALL orders use rate 1; foreign orders use their own stored rate", `
      SELECT order_number FROM orders WHERE (currency_code = 'ALL' AND all_per_unit <> 1) OR all_per_unit <= 0`);
    await none(db, "outstanding balances are within 0 … total", `
      SELECT i.invoice_number FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id GROUP BY i.id
      HAVING i.total - coalesce(sum(p.amount), 0) < 0 OR i.total - coalesce(sum(p.amount), 0) > i.total`);

    const { rows: conv } = await db.query(`
      SELECT i.invoice_number, i.currency_code cur, i.total, i.all_per_unit rate,
             round(i.total * i.all_per_unit, 2) all_equivalent,
             i.total - coalesce((SELECT sum(amount) FROM payments p WHERE p.invoice_id = i.id), 0) outstanding
      FROM invoices i ORDER BY i.invoice_number`);
    console.log("  ALL equivalents at the stored invoice rate:");
    conv.forEach((r) => console.log(`    ${r.invoice_number}  ${r.total} ${r.cur} × ${Number(r.rate)} = ${r.all_equivalent} ALL  (outstanding ${r.outstanding} ${r.cur})`));
    const expected: Record<string, string> = { "INV-2026-001": "4296.00", "INV-2026-002": "6768.00", "INV-2026-003": "5559.30", "INV-2026-004": "2304.00" };
    check("ALL equivalents equal total × stored rate", conv.every((r) => expected[r.invoice_number] === r.all_equivalent), JSON.stringify(conv.map((r) => r.all_equivalent)));
  } finally {
    await db.end();
  }
}

/* ------------------------------------------------------------------ */

async function buildScratchDatabase() {
  const admin = await connect(adminUrl);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);
  } finally {
    await admin.end();
  }
  const env = { ...process.env, DATABASE_URL: scratchUrl };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  execFileSync("npx", ["tsx", "prisma/seed.ts"], { env, stdio: "pipe" });
}

async function dropScratchDatabase() {
  const admin = await connect(adminUrl);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function ids(db: Client) {
  const { rows } = await db.query(`
    SELECT i.invoice_number, i.id, i.order_id, i.currency_code, i.total,
           i.total - coalesce((SELECT sum(amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS outstanding
    FROM invoices i`);
  return Object.fromEntries(rows.map((r) => [r.invoice_number, r])) as Record<string, { id: string; order_id: string; currency_code: string; total: string; outstanding: string }>;
}

const PAY = `INSERT INTO payments (id, invoice_id, payment_date, amount, currency_code, method, reference) VALUES (gen_random_uuid(), $1, CURRENT_DATE, $2, $3, 'BANK_TRANSFER', $4)`;

async function guardTests() {
  console.log("\n2. Financial guards (throwaway database)");
  const db = await connect(scratchUrl);
  try {
    const inv = await ids(db);
    const i1 = inv["INV-2026-001"]; // ALL, partially paid, 376.00 outstanding
    const i3 = inv["INV-2026-003"]; // USD, unpaid, 61.77 outstanding
    await db.query("BEGIN");

    // Payments
    await rejects(db, "zero payment rejected", PAY, [i3.id, "0", "USD", "t0"], /payments_amount_positive/);
    await rejects(db, "negative payment rejected", PAY, [i3.id, "-5", "USD", "t1"], /payments_amount_positive/);
    await rejects(db, "overpayment rejected (outstanding + 0.01)", PAY, [i1.id, "376.01", "ALL", "t2"], /Overpayment forbidden/);
    await rejects(db, "payment in a different currency rejected", PAY, [i3.id, "10", "EUR", "t3"], /currency must match/);
    await rejects(db, "payment edit rejected", `UPDATE payments SET amount = amount + 1`, [], /cannot be edited/);
    await rejects(db, "payment delete rejected", `DELETE FROM payments`, [], /cannot be deleted/);

    // Invoices
    await rejects(db, "issued invoice total is immutable", `UPDATE invoices SET total = total + 1, vat_total = vat_total + 1 WHERE id = $1`, [i3.id], /immutable/);
    await rejects(db, "issued invoice rate is immutable", `UPDATE invoices SET all_per_unit = 95 WHERE id = $1`, [i3.id], /immutable/);
    await rejects(db, "invoice delete rejected", `DELETE FROM invoices WHERE id = $1`, [i3.id], /cannot be deleted/);
    await rejects(db, "cancelling an invoice with payments rejected", `UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [i1.id], /with payments/);
    await db.query("SAVEPOINT c");
    await rejects(db, "cancellation without time and reason rejected", `UPDATE invoices SET status = 'CANCELLED' WHERE id = $1`, [i3.id], /invoices_cancellation_fields/);
    await db.query(`UPDATE invoices SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'verification' WHERE id = $1`, [i3.id]); // allowed: no payments yet
    await rejects(db, "payment on a cancelled invoice rejected", PAY, [i3.id, "1", "USD", "t4"], /not payable/);
    await rejects(db, "cancelled invoice cannot be reissued in place", `UPDATE invoices SET status = 'ISSUED', cancelled_at = NULL, cancellation_reason = NULL WHERE id = $1`, [i3.id], /Cancelled invoice is final/);
    {
      const copy = `INSERT INTO invoices (id, invoice_number, order_id, currency_code, all_per_unit, subtotal_net, discount_total, taxable_total, vat_total, total, issue_date, due_date, replaces_invoice_id)
        SELECT gen_random_uuid(), $2, order_id, currency_code, all_per_unit, subtotal_net, discount_total, taxable_total, vat_total, total, issue_date, due_date, $3 FROM invoices WHERE id = $1`;
      await rejects(db, "re-invoicing requires a replacement link", copy, [i3.id, "T-R0", null], /must reference the cancelled invoice/);
      await db.query("SAVEPOINT r");
      try {
        await db.query(copy, [i3.id, "T-R1", i3.id]);
        pass("replacement for a cancelled invoice is accepted");
      } catch (e) {
        fail("replacement for a cancelled invoice is accepted", (e as Error).message);
      }
      await rejects(db, "a cancelled invoice is replaced at most once", copy, [i3.id, "T-R2", i3.id], /already has an issued invoice|invoices_replaces_invoice_id_key/);
      await db.query("ROLLBACK TO SAVEPOINT r");
    }
    await db.query("ROLLBACK TO SAVEPOINT c");

    // Invoiced orders are frozen
    await rejects(db, "invoiced order totals are locked", `UPDATE orders SET grand_total = grand_total + 1, vat_total = vat_total + 1 WHERE id = $1`, [i1.order_id], /financially locked/);
    await rejects(db, "invoiced order rate is locked", `UPDATE orders SET all_per_unit = 2 WHERE id = $1`, [i3.order_id], /financially locked/);
    await rejects(db, "invoiced order cannot be cancelled", `UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [i1.order_id], /issued invoice/);
    {
      await db.query("SAVEPOINT s");
      try {
        await db.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [i1.order_id]);
        await db.query(`UPDATE orders SET status = 'DELIVERED' WHERE id = $1`, [i1.order_id]);
        pass("invoiced order may progress CONFIRMED → PROCESSING → DELIVERED");
      } catch (e) {
        fail("invoiced order may progress CONFIRMED → PROCESSING → DELIVERED", (e as Error).message);
      }
      await rejects(db, "delivered order cannot go back", `UPDATE orders SET status = 'CONFIRMED' WHERE id = $1`, [i1.order_id], /Invalid order status transition/);
      await rejects(db, "status change does not unlock totals", `UPDATE orders SET grand_total = grand_total + 1, vat_total = vat_total + 1 WHERE id = $1`, [i1.order_id], /financially locked/);
      await db.query("ROLLBACK TO SAVEPOINT s");
    }
    await rejects(db, "invoiced order items cannot change", `UPDATE order_items SET quantity = quantity + 1 WHERE order_id = $1`, [i1.order_id], /invoiced order/);
    await rejects(db, "invoiced order items cannot be deleted", `DELETE FROM order_items WHERE order_id = $1`, [i1.order_id], /invoiced order/);
    await rejects(db, "items cannot be added to an invoiced order", `
      INSERT INTO order_items (id, order_id, product_id, product_sku, product_name, unit, quantity, unit_net_price, discount_percent, vat_rate, gross_net, discount_amount, taxable_amount, vat_amount, line_total)
      SELECT gen_random_uuid(), order_id, product_id, product_sku, product_name, unit, 1, 0, 0, 0, 0, 0, 0, 0, 0 FROM order_items WHERE order_id = $1 LIMIT 1`, [i1.order_id], /invoiced order/);
    {
      const { rows } = await db.query(`SELECT name, default_net_all FROM products ORDER BY sku LIMIT 1`);
      await db.query("SAVEPOINT p");
      await db.query(`UPDATE products SET default_net_all = default_net_all * 3`);
      const { rows: after } = await db.query(`SELECT count(*)::int n FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.unit_net_price = round(p.default_net_all / (SELECT all_per_unit FROM orders WHERE id = i.order_id), 4)`);
      const { rows: inv1 } = await db.query(`SELECT total FROM invoices WHERE id = $1`, [i1.id]);
      check("repricing a product leaves historical lines and invoices unchanged", after[0].n === 0 && inv1[0].total === i1.total, `${rows[0].name}: price ×3, invoice still ${inv1[0].total}`);
      await db.query("ROLLBACK TO SAVEPOINT p");
    }

    // Order / item arithmetic constraints
    const orderCols = `id, order_number, customer_id, sales_rep_id, currency_code, all_per_unit, status, subtotal_net, discount_total, taxable_total, vat_total, grand_total, updated_at`;
    const draft = `SELECT gen_random_uuid(), $1, customer_id, sales_rep_id, $2, $3, 'DRAFT', $4::numeric, $5::numeric, $6::numeric, $7::numeric, $8::numeric, now() FROM orders LIMIT 1`;
    await rejects(db, "order total identity enforced", `INSERT INTO orders (${orderCols}) ${draft}`, ["T-1", "ALL", 1, 100, 0, 100, 20, 999], /orders_total_identity/);
    await rejects(db, "ALL orders must use rate 1", `INSERT INTO orders (${orderCols}) ${draft}`, ["T-2", "ALL", 2, 0, 0, 0, 0, 0], /orders_all_rate/);
    await rejects(db, "exchange rate must be positive", `INSERT INTO orders (${orderCols}) ${draft}`, ["T-3", "EUR", 0, 0, 0, 0, 0, 0], /orders_rate_positive/);
    await rejects(db, "negative product price rejected", `UPDATE products SET default_net_all = -1`, [], /products_price_nonnegative/);
    await rejects(db, "VAT above 100% rejected", `UPDATE products SET vat_rate = 101`, [], /products_vat_range/);

    // Invoice issuance rules
    {
      await db.query("SAVEPOINT o");
      const { rows: [o] } = await db.query(
        `INSERT INTO orders (${orderCols}) SELECT gen_random_uuid(), 'T-DRAFT', customer_id, sales_rep_id, 'ALL', 1, 'DRAFT', 100, 0, 100, 20, 120, now() FROM orders LIMIT 1 RETURNING id`,
      );
      await db.query(
        `INSERT INTO order_items (id, order_id, product_id, product_sku, product_name, unit, quantity, unit_net_price, discount_percent, vat_rate, gross_net, discount_amount, taxable_amount, vat_amount, line_total)
         SELECT gen_random_uuid(), $1, id, sku, name, unit, 1, 100, 0, 20, 100, 0, 100, 20, 120 FROM products LIMIT 1`,
        [o.id],
      );
      await rejects(db, "line total identity enforced on a draft order", `UPDATE order_items SET line_total = line_total + 1 WHERE order_id = $1`, [o.id], /order_items_total_identity/);
      await rejects(db, "discount above 100% rejected", `UPDATE order_items SET discount_percent = 101 WHERE order_id = $1`, [o.id], /order_items_discount_range/);
      await rejects(db, "zero quantity rejected", `UPDATE order_items SET quantity = 0 WHERE order_id = $1`, [o.id], /order_items_quantity_positive/);
      const inv = `INSERT INTO invoices (id, invoice_number, order_id, currency_code, all_per_unit, subtotal_net, discount_total, taxable_total, vat_total, total, issue_date, due_date) VALUES (gen_random_uuid(), $2, $1, 'ALL', 1, $3::numeric, 0, $3::numeric, $4::numeric, $5::numeric, CURRENT_DATE, CURRENT_DATE + 30)`;
      await rejects(db, "cannot invoice a draft order", inv, [o.id, "T-INV-1", 100, 20, 120], /confirmed order/);
      await db.query(`UPDATE orders SET status = 'CONFIRMED' WHERE id = $1`, [o.id]);
      await rejects(db, "invoice must snapshot the order totals", inv, [o.id, "T-INV-2", 100, 25, 125], /snapshot order totals/);
      await db.query(`UPDATE orders SET subtotal_net = 200, taxable_total = 200, vat_total = 40, grand_total = 240 WHERE id = $1`, [o.id]);
      await rejects(db, "cannot invoice an order whose items do not reconcile", inv, [o.id, "T-INV-3", 200, 40, 240], /do not reconcile/);
      await db.query(`UPDATE orders SET subtotal_net = 100, taxable_total = 100, vat_total = 20, grand_total = 120 WHERE id = $1`, [o.id]);
      await rejects(db, "invoice due date before issue date rejected", inv.replace("CURRENT_DATE + 30", "CURRENT_DATE - 1"), [o.id, "T-INV-4", 100, 20, 120], /invoices_dates/);
      await db.query("SAVEPOINT ok");
      try {
        await db.query(inv, [o.id, "T-INV-5", 100, 20, 120]);
        pass("valid invoice for a confirmed, reconciled order is accepted");
      } catch (e) {
        fail("valid invoice for a confirmed, reconciled order is accepted", (e as Error).message);
      }
      await db.query("ROLLBACK TO SAVEPOINT o");
    }

    // Sub-cent input is coerced by numeric(18,2), not rejected
    {
      await db.query("SAVEPOINT r");
      const { rows } = await db.query(`${PAY} RETURNING amount`, [i3.id, "10.005", "USD", "t-round"]);
      console.log(`  NOTE  payment amount 10.005 was stored as ${rows[0].amount}: numeric(18,2) rounds sub-cent input, so the payment service rejects it before insert (tests/unit/money.test.ts)`);
      await db.query("ROLLBACK TO SAVEPOINT r");
    }

    await db.query("ROLLBACK");
  } finally {
    await db.end();
  }
}

/** Two sessions try to pay the full outstanding balance of the same invoice at once. */
async function racePair(level: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE", invoiceNumber: string) {
  const a = await connect(scratchUrl);
  const b = await connect(scratchUrl);
  try {
    const inv = (await ids(a))[invoiceNumber];
    const amount = inv.outstanding;
    await a.query(`BEGIN ISOLATION LEVEL ${level}`);
    await b.query(`BEGIN ISOLATION LEVEL ${level}`);
    await b.query("SELECT 1"); // take B's snapshot before A commits
    await a.query(PAY, [inv.id, amount, inv.currency_code, `race-a-${level}`]);
    const bResult = b.query(PAY, [inv.id, amount, inv.currency_code, `race-b-${level}`]).then(
      () => b.query("COMMIT").then(() => "committed"),
      (e: Error) => b.query("ROLLBACK").then(() => "rejected: " + e.message),
    );
    await new Promise((r) => setTimeout(r, 300)); // B is now waiting on A's lock
    await a.query("COMMIT");
    const outcome = await bResult;
    const after = (await ids(a))[invoiceNumber];
    const ok = Number(after.outstanding) >= 0 && outcome.startsWith("rejected");
    check(`concurrent full payments (${level})`, ok, `A committed; B ${outcome}; outstanding now ${after.outstanding} ${inv.currency_code}`);
  } finally {
    await a.end();
    await b.end();
  }
}

/** Ten sessions each pay 15% of the remaining balance simultaneously; total must never exceed the invoice. */
async function burst(invoiceNumber: string) {
  const setup = await connect(scratchUrl);
  const inv = (await ids(setup))[invoiceNumber];
  await setup.end();
  const share = (Number(inv.outstanding) * 0.15).toFixed(2);
  const clients = await Promise.all(Array.from({ length: 10 }, () => connect(scratchUrl)));
  const results = await Promise.allSettled(clients.map((c, k) => c.query(PAY, [inv.id, share, inv.currency_code, `burst-${k}`])));
  await Promise.all(clients.map((c) => c.end()));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const check2 = await connect(scratchUrl);
  const after = (await ids(check2))[invoiceNumber];
  await check2.end();
  check(
    "10 simultaneous payments never exceed the invoice total",
    Number(after.outstanding) >= 0 && ok === Math.floor(Number(inv.outstanding) / Number(share)),
    `${ok} accepted × ${share}, ${10 - ok} rejected; outstanding ${after.outstanding} of ${inv.total} ${inv.currency_code}`,
  );
}

async function concurrencyTests() {
  console.log("\n3. Concurrent payments (throwaway database)");
  await racePair("READ COMMITTED", "INV-2026-003");
  await buildScratchDatabase();
  await racePair("REPEATABLE READ", "INV-2026-003");
  await buildScratchDatabase();
  await racePair("SERIALIZABLE", "INV-2026-003");
  await buildScratchDatabase();
  await burst("INV-2026-001");
}

async function main() {
  await verifyDevelopmentDatabase();
  await buildScratchDatabase();
  try {
    await guardTests();
    await concurrencyTests();
  } finally {
    await dropScratchDatabase();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  process.exitCode = failures ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await dropScratchDatabase().catch(() => {});
  process.exitCode = 1;
});
