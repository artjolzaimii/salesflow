-- Fix: concurrent payments could overpay an invoice under REPEATABLE READ / SERIALIZABLE.
--
-- The approved guard_payment() locked the invoice with SELECT ... FOR UPDATE and then
-- summed existing payments. Under READ COMMITTED that is safe: the waiting transaction
-- re-reads after the lock is released. Under REPEATABLE READ the waiting transaction
-- keeps its original snapshot, never sees the payment committed by the lock holder,
-- and a row that was only *locked* (not modified) raises no serialization conflict.
-- Verified in scripts/verify-guards.ts: two full payments of 61.77 USD both committed,
-- leaving an outstanding balance of -61.77.
--
-- The lock is now taken with a no-op UPDATE of the invoice row. A concurrent
-- REPEATABLE READ or SERIALIZABLE transaction that reaches the same invoice after
-- another payment committed gets "could not serialize access due to concurrent
-- update" and must retry; READ COMMITTED behaviour is unchanged. guard_invoice()
-- permits this UPDATE because no snapshot column changes. All other rules are
-- identical to 20261116205247_financial_guards.
CREATE OR REPLACE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; existing numeric(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payments cannot be deleted; use reversal workflow'; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Payments cannot be edited; use reversal workflow'; END IF;
  UPDATE invoices SET status = status WHERE id = NEW.invoice_id RETURNING * INTO inv;
  IF NOT FOUND OR inv.status <> 'ISSUED' THEN RAISE EXCEPTION 'Invoice not payable'; END IF;
  IF NEW.currency_code <> inv.currency_code THEN RAISE EXCEPTION 'Payment currency must match invoice'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO existing FROM payments WHERE invoice_id = inv.id;
  IF existing + NEW.amount > inv.total THEN RAISE EXCEPTION 'Overpayment forbidden'; END IF;
  RETURN NEW;
END $$;
