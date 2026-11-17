-- Phase 5E: audit fields and reporting indexes (version-controlled; never apply by hand).
--
-- 1. payments.recorded_by_user_id: the user who recorded the payment.
--    - Nullable: payments recorded before this migration have no attribution and
--      none is invented for them.
--    - Immutable: guard_payment() already refuses every UPDATE of a payment, so the
--      attribution can never change once written.
--    - The payment service always sets it from the authenticated session.
--
-- 2. invoices.billing_address_snapshot: the customer's billing details (business
--    name, NIPT, billing address) copied when the invoice is issued.
--    - Nullable: invoices issued before this migration keep NULL; no historical
--      snapshot is fabricated.
--    - Immutable: added to the frozen columns in guard_invoice().
--    - A replacement invoice must carry the same snapshot as the cancelled invoice
--      it replaces when that invoice has one (snapshot preservation, like the
--      financial snapshot). A replacement of a pre-snapshot invoice records the
--      customer's billing details at the time the replacement is issued.
--
-- 3. Reporting indexes, for the date-range aggregations in
--    src/server/services/reports.ts:
--    - invoices (status, issue_date): invoiced sales filter ISSUED invoices by issue date.
--    - payments (payment_date): payment collections filter by payment date across all invoices
--      (the existing (invoice_id, payment_date) index only helps per invoice).

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "recorded_by_user_id" UUID;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "billing_address_snapshot" JSONB;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "invoices_status_issue_date_idx" ON "invoices"("status", "issue_date");

-- CreateIndex
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");

ALTER TABLE invoices
  ADD CONSTRAINT invoices_billing_snapshot_object CHECK (billing_address_snapshot IS NULL OR jsonb_typeof(billing_address_snapshot) = 'object');

-- Invoices: same rules as 20261117090000_business_rules_invoice_replacement, plus the billing snapshot.
CREATE OR REPLACE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE; replaced invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoices cannot be deleted'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.order_id, NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.total, NEW.issue_date, NEW.due_date, NEW.invoice_number, NEW.replaces_invoice_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.order_id, OLD.currency_code, OLD.all_per_unit, OLD.subtotal_net, OLD.discount_total, OLD.taxable_total, OLD.vat_total, OLD.total, OLD.issue_date, OLD.due_date, OLD.invoice_number, OLD.replaces_invoice_id, OLD.created_at)
    THEN RAISE EXCEPTION 'Issued invoice financial snapshot is immutable'; END IF;
    IF NEW.billing_address_snapshot IS DISTINCT FROM OLD.billing_address_snapshot THEN
      RAISE EXCEPTION 'Invoice billing snapshot is immutable';
    END IF;
    IF OLD.status = 'CANCELLED' THEN
      IF (NEW.status, NEW.cancelled_at, NEW.cancellation_reason, NEW.cancelled_by_id)
         IS DISTINCT FROM (OLD.status, OLD.cancelled_at, OLD.cancellation_reason, OLD.cancelled_by_id)
      THEN RAISE EXCEPTION 'Cancelled invoice is final'; END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = 'CANCELLED' AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot cancel invoice with payments';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.status <> 'ISSUED' THEN RAISE EXCEPTION 'Invoices must be created as ISSUED'; END IF;
  SELECT * INTO o FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND OR o.status NOT IN ('CONFIRMED', 'PROCESSING', 'DELIVERED') THEN
    RAISE EXCEPTION 'Invoice requires a confirmed order';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE order_id = o.id AND status = 'ISSUED') THEN
    RAISE EXCEPTION 'Order already has an issued invoice';
  END IF;
  IF NEW.replaces_invoice_id IS NOT NULL THEN
    SELECT * INTO replaced FROM invoices WHERE id = NEW.replaces_invoice_id;
    IF NOT FOUND OR replaced.order_id <> o.id OR replaced.status <> 'CANCELLED' THEN
      RAISE EXCEPTION 'Replacement must reference a cancelled invoice of the same order';
    END IF;
    IF replaced.billing_address_snapshot IS NOT NULL AND NEW.billing_address_snapshot IS DISTINCT FROM replaced.billing_address_snapshot THEN
      RAISE EXCEPTION 'Replacement must keep the billing snapshot of the invoice it replaces';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM invoices WHERE order_id = o.id) THEN
    RAISE EXCEPTION 'Replacement invoice must reference the cancelled invoice it replaces';
  END IF;
  IF (NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.total)
    IS DISTINCT FROM (o.currency_code, o.all_per_unit, o.subtotal_net, o.discount_total, o.taxable_total, o.vat_total, o.grand_total)
  THEN RAISE EXCEPTION 'Invoice must snapshot order totals'; END IF;
  IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id) THEN RAISE EXCEPTION 'Cannot invoice empty order'; END IF;
  IF EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id HAVING SUM(gross_net) <> o.subtotal_net OR SUM(discount_amount) <> o.discount_total OR SUM(taxable_amount) <> o.taxable_total OR SUM(vat_amount) <> o.vat_total OR SUM(line_total) <> o.grand_total) THEN
    RAISE EXCEPTION 'Order item totals do not reconcile';
  END IF;
  RETURN NEW;
END $$;
