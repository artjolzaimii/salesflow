-- SalesFlow financial guards (approved database starter, prisma/financial-guards.sql).
-- Version-controlled here so 'prisma migrate deploy' applies them; never apply by hand.
-- CHECK constraints and triggers are invisible to schema.prisma; see docs/database.md.

ALTER TABLE products ADD CONSTRAINT products_price_nonnegative CHECK (default_net_all >= 0), ADD CONSTRAINT products_vat_range CHECK (vat_rate BETWEEN 0 AND 100);
ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_positive CHECK (all_per_unit > 0);
ALTER TABLE orders ADD CONSTRAINT orders_rate_positive CHECK (all_per_unit > 0), ADD CONSTRAINT orders_totals_nonnegative CHECK (subtotal_net >= 0 AND discount_total >= 0 AND taxable_total >= 0 AND vat_total >= 0 AND grand_total >= 0), ADD CONSTRAINT orders_total_identity CHECK (subtotal_net - discount_total = taxable_total AND taxable_total + vat_total = grand_total), ADD CONSTRAINT orders_all_rate CHECK (currency_code <> 'ALL' OR all_per_unit = 1);
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0), ADD CONSTRAINT order_items_price_nonnegative CHECK (unit_net_price >= 0), ADD CONSTRAINT order_items_discount_range CHECK (discount_percent BETWEEN 0 AND 100), ADD CONSTRAINT order_items_vat_range CHECK (vat_rate BETWEEN 0 AND 100), ADD CONSTRAINT order_items_totals_nonnegative CHECK (gross_net >= 0 AND discount_amount >= 0 AND taxable_amount >= 0 AND vat_amount >= 0 AND line_total >= 0), ADD CONSTRAINT order_items_total_identity CHECK (gross_net - discount_amount = taxable_amount AND taxable_amount + vat_amount = line_total);
ALTER TABLE invoices ADD CONSTRAINT invoices_total_nonnegative CHECK (total >= 0), ADD CONSTRAINT invoices_total_identity CHECK (subtotal_net - discount_total = taxable_total AND taxable_total + vat_total = total), ADD CONSTRAINT invoices_dates CHECK (due_date >= issue_date);
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

CREATE OR REPLACE FUNCTION protect_invoiced_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE order_id = OLD.id) AND
    (NEW.customer_id, NEW.sales_rep_id, NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.grand_total, NEW.status)
    IS DISTINCT FROM
    (OLD.customer_id, OLD.sales_rep_id, OLD.currency_code, OLD.all_per_unit, OLD.subtotal_net, OLD.discount_total, OLD.taxable_total, OLD.vat_total, OLD.grand_total, OLD.status)
  THEN RAISE EXCEPTION 'Invoiced order is financially locked'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_invoiced_lock BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_invoiced_order();

CREATE OR REPLACE FUNCTION protect_invoiced_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid uuid;
BEGIN
  oid := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  IF EXISTS (SELECT 1 FROM invoices WHERE order_id = oid) THEN RAISE EXCEPTION 'Cannot change items of an invoiced order'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.order_id <> OLD.order_id AND EXISTS (SELECT 1 FROM invoices WHERE order_id = OLD.order_id) THEN
    RAISE EXCEPTION 'Cannot move item from invoiced order';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER items_invoiced_lock BEFORE INSERT OR UPDATE OR DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION protect_invoiced_items();

CREATE OR REPLACE FUNCTION guard_invoice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoices cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.order_id, NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.total, NEW.issue_date, NEW.due_date, NEW.invoice_number)
       IS DISTINCT FROM
       (OLD.order_id, OLD.currency_code, OLD.all_per_unit, OLD.subtotal_net, OLD.discount_total, OLD.taxable_total, OLD.vat_total, OLD.total, OLD.issue_date, OLD.due_date, OLD.invoice_number)
    THEN RAISE EXCEPTION 'Issued invoice financial snapshot is immutable'; END IF;
    IF NEW.status = 'CANCELLED' AND OLD.status <> 'CANCELLED' AND EXISTS (SELECT 1 FROM payments WHERE invoice_id = OLD.id) THEN
      RAISE EXCEPTION 'Cannot cancel invoice with payments';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM orders WHERE id = NEW.order_id FOR UPDATE;
  IF NOT FOUND OR o.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'Invoice requires a confirmed order'; END IF;
  IF (NEW.currency_code, NEW.all_per_unit, NEW.subtotal_net, NEW.discount_total, NEW.taxable_total, NEW.vat_total, NEW.total)
    IS DISTINCT FROM (o.currency_code, o.all_per_unit, o.subtotal_net, o.discount_total, o.taxable_total, o.vat_total, o.grand_total)
  THEN RAISE EXCEPTION 'Invoice must snapshot order totals'; END IF;
  IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id) THEN RAISE EXCEPTION 'Cannot invoice empty order'; END IF;
  IF EXISTS (SELECT 1 FROM order_items WHERE order_id = o.id HAVING SUM(gross_net) <> o.subtotal_net OR SUM(discount_amount) <> o.discount_total OR SUM(taxable_amount) <> o.taxable_total OR SUM(vat_amount) <> o.vat_total OR SUM(line_total) <> o.grand_total) THEN
    RAISE EXCEPTION 'Order item totals do not reconcile';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION guard_invoice();

CREATE OR REPLACE FUNCTION guard_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; existing numeric(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payments cannot be deleted; use reversal workflow'; END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Payments cannot be edited; use reversal workflow'; END IF;
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR inv.status <> 'ISSUED' THEN RAISE EXCEPTION 'Invoice not payable'; END IF;
  IF NEW.currency_code <> inv.currency_code THEN RAISE EXCEPTION 'Payment currency must match invoice'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO existing FROM payments WHERE invoice_id = inv.id;
  IF existing + NEW.amount > inv.total THEN RAISE EXCEPTION 'Overpayment forbidden'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_guard BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION guard_payment();
