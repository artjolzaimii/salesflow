\pset null '(null)'
SELECT o.order_number, o.currency_code, o.grand_total,
       COALESCE(SUM(oi.line_total), 0) AS line_sum,
       o.grand_total = COALESCE(SUM(oi.line_total), 0) AS reconciles
FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id ORDER BY o.order_number;
SELECT i.invoice_number, i.currency_code, i.total,
       COALESCE(SUM(p.amount),0) AS paid,
       i.total - COALESCE(SUM(p.amount),0) AS outstanding,
       CASE WHEN i.status = 'CANCELLED' THEN 'CANCELLED'
            WHEN COALESCE(SUM(p.amount),0) = i.total THEN 'PAID'
            WHEN i.due_date < CURRENT_DATE THEN 'OVERDUE'
            WHEN COALESCE(SUM(p.amount),0) > 0 THEN 'PARTIALLY_PAID'
            ELSE 'ISSUED' END AS derived_status
FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id ORDER BY i.invoice_number;
SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM customers) customers,
       (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM orders) orders,
       (SELECT COUNT(*) FROM invoices) invoices, (SELECT COUNT(*) FROM ai_conversations) ai_conversations;
