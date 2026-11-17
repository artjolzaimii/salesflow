\pset null '(null)'
SELECT o.order_number, o.currency_code, o.grand_total,
       COALESCE(SUM(oi.line_total), 0) AS line_sum,
       o.grand_total = COALESCE(SUM(oi.line_total), 0) AS reconciles
FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id ORDER BY o.order_number;
-- Payment status as the application derives it (src/lib/invoice-status.ts); overdue is a separate flag.
SELECT i.invoice_number, i.currency_code, i.total,
       COALESCE(SUM(p.amount),0) AS paid,
       CASE WHEN i.status = 'CANCELLED' THEN 0 ELSE i.total - COALESCE(SUM(p.amount),0) END AS outstanding,
       CASE WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
            WHEN COALESCE(SUM(p.amount),0) >= i.total THEN 'PAID'
            WHEN COALESCE(SUM(p.amount),0) > 0 THEN 'PARTIALLY_PAID'
            ELSE 'UNPAID' END AS payment_status,
       i.status = 'ISSUED' AND COALESCE(SUM(p.amount),0) < i.total
         AND i.due_date < (now() AT TIME ZONE 'Europe/Tirane')::date AS overdue
FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id ORDER BY i.invoice_number;
-- Internal invoice numbering: each year's counter is at least the highest INV-<year>-<n> on record.
SELECT c.year, c.last_value,
       (SELECT MAX((m[1])::bigint) FROM invoices, regexp_match(invoice_number, '^INV-' || c.year || '-(\d+)$') m) AS highest_issued,
       c.last_value >= COALESCE((SELECT MAX((m[1])::bigint) FROM invoices, regexp_match(invoice_number, '^INV-' || c.year || '-(\d+)$') m), 0) AS consistent
FROM invoice_number_counters c ORDER BY c.year;
SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM customers) customers,
       (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM orders) orders,
       (SELECT COUNT(*) FROM invoices) invoices, (SELECT COUNT(*) FROM payments) payments,
       (SELECT COUNT(*) FROM ai_conversations) ai_conversations;
