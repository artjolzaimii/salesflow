-- Phase 5A business rules (version-controlled; never apply by hand).
--
-- 1. Enums: CAFE business type, REGISTERED_OFFICE address type.
-- 2. Order status lifecycle. The financial lock on invoiced orders no longer
--    freezes `status`, so an invoiced order can move CONFIRMED -> PROCESSING ->
--    DELIVERED. Every money column, the rate, customer, rep and the items stay
--    locked once any invoice (issued or cancelled) exists. Allowed transitions:
--      DRAFT -> CONFIRMED | CANCELLED
--      CONFIRMED -> PROCESSING | CANCELLED
--      PROCESSING -> DELIVERED | CANCELLED
--    An order with an ISSUED invoice cannot be cancelled (cancel the invoice first).
--    New orders start as DRAFT or CONFIRMED.
-- 3. Invoice cancellation and replacement. order_id is no longer unique; a
--    partial unique index allows one ISSUED invoice per order, cancelled ones stay
--    on record. A cancelled invoice is final (no CANCELLED -> ISSUED), needs a
--    timestamp and reason, and still cannot be cancelled while it has payments.
--    A further invoice for the same order must reference the cancelled invoice it
--    replaces (each replaced at most once) and snapshots the same locked totals.
-- 4. payments.idempotency_key: lets the payment service return the original row
--    when a request is retried, instead of inserting a duplicate.
-- guard_payment() (snapshot-safe version) is unchanged.

-- AlterEnum
ALTER TYPE "AddressType" ADD VALUE 'REGISTERED_OFFICE';

-- AlterEnum
ALTER TYPE "BusinessType" ADD VALUE 'CAFE';

-- DropIndex
DROP INDEX "invoices_order_id_key";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "cancellation_reason" VARCHAR(500),
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "cancelled_by_id" UUID,
ADD COLUMN     "replaces_invoice_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "idempotency_key" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_replaces_invoice_id_key" ON "invoices"("replaces_invoice_id");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "invoices"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_one_issued_per_order" ON "invoices"("order_id") WHERE (status = 'ISSUED');

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_replaces_invoice_id_fkey" FOREIGN KEY ("replaces_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK constraints -----------------------------------------------------------
ALTER TABLE invoices
  ADD CONSTRAINT invoices_cancellation_fields CHECK (
    (status = 'ISSUED' AND cancelled_at IS NULL AND cancellation_reason IS NULL AND cancelled_by_id IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
  ),
  ADD CONSTRAINT invoices_not_self_replacing CHECK (replaces_invoice_id IS NULL OR replaces_invoice_id <> id);

ALTER TABLE payments
  ADD CONSTRAINT payments_idempotency_key_nonblank CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> '');

-- Orders: financial lock (status excluded) + status lifecycle ------------------
CREATE OR REPLACE FUNCTION protect_invoiced_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('DRAFT', 'CONFIRMED') THEN
      RAISE EXCEPTION 'New orders must start as DRAFT or CONFIRMED';
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM invoices WHERE order_id = OLD.id) AND
    (NEW.customer_id, NEW.sales_rep_id, NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.grand_total)
    IS DISTINCT FROM
    (OLD.customer_id, OLD.sales_rep_id, OLD.currency_code, OLD.all_per_unit, OLD.subtotal_net, OLD.discount_total, OLD.taxable_total, OLD.vat_total, OLD.grand_total)
  THEN RAISE EXCEPTION 'Invoiced order is financially locked'; END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('CONFIRMED', 'CANCELLED')) OR
      (OLD.status = 'CONFIRMED' AND NEW.status IN ('PROCESSING', 'CANCELLED')) OR
      (OLD.status = 'PROCESSING' AND NEW.status IN ('DELIVERED', 'CANCELLED'))
    ) THEN
      RAISE EXCEPTION 'Invalid order status transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'CANCELLED' AND EXISTS (SELECT 1 FROM invoices WHERE order_id = OLD.id AND status = 'ISSUED') THEN
      RAISE EXCEPTION 'Cannot cancel an order with an issued invoice';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER orders_invoiced_lock ON orders;
CREATE TRIGGER orders_invoiced_lock BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_invoiced_order();

-- Invoices: immutability, final cancellation, replacement ---------------------
CREATE OR REPLACE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE; replaced invoices%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoices cannot be deleted'; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.order_id, NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.total, NEW.issue_date, NEW.due_date, NEW.invoice_number, NEW.replaces_invoice_id, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.order_id, OLD.currency_code, OLD.all_per_unit, OLD.subtotal_net, OLD.discount_total, OLD.taxable_total, OLD.vat_total, OLD.total, OLD.issue_date, OLD.due_date, OLD.invoice_number, OLD.replaces_invoice_id, OLD.created_at)
    THEN RAISE EXCEPTION 'Issued invoice financial snapshot is immutable'; END IF;
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
