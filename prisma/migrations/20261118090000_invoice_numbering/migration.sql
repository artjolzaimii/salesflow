-- Phase 5D: concurrency-safe, gap-free internal invoice numbering (version-controlled; never apply by hand).
--
-- Internal SalesFlow identifiers of the form INV-<year>-<6 digits>, e.g. INV-2026-000001.
-- They are NOT fiscalized (Albanian e-invoicing) numbers.
--
-- One counter row per issue year. next_invoice_number() increments it with an
-- INSERT ... ON CONFLICT DO UPDATE, which row-locks the counter until the issuing
-- transaction ends:
-- - concurrent issuers queue on the row lock, so two invoices never get the same value;
-- - a rolled-back issuance rolls the increment back too, so committed numbers are
--   consecutive (no gaps) and a number is never handed out twice;
-- - counters only move forward (trigger below) and cannot be deleted, so a
--   number, including one of a cancelled invoice, is never reused.
-- invoices.invoice_number keeps its unique index as the final guarantee.

-- CreateTable
CREATE TABLE "invoice_number_counters" (
    "year" INTEGER NOT NULL,
    "last_value" BIGINT NOT NULL,

    CONSTRAINT "invoice_number_counters_pkey" PRIMARY KEY ("year")
);

ALTER TABLE invoice_number_counters
  ADD CONSTRAINT invoice_number_counters_year_range CHECK (year BETWEEN 2000 AND 9999),
  ADD CONSTRAINT invoice_number_counters_value_range CHECK (last_value BETWEEN 0 AND 999999);

CREATE OR REPLACE FUNCTION guard_invoice_number_counter() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Invoice number counters cannot be deleted'; END IF;
  IF NEW.year <> OLD.year OR NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'Invoice number counters only move forward';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_number_counter_guard BEFORE UPDATE OR DELETE ON invoice_number_counters
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_number_counter();

-- Allocates the next number for an issue year. Call inside the issuing transaction.
CREATE OR REPLACE FUNCTION next_invoice_number(p_year integer) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO invoice_number_counters AS c (year, last_value) VALUES (p_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_value = c.last_value + 1
  RETURNING c.last_value INTO n;
  RETURN 'INV-' || p_year::text || '-' || lpad(n::text, 6, '0');
END $$;

-- Raises each year's counter to the highest INV-<year>-<n> already on record
-- (seeded or earlier invoices), so new numbers continue after them.
CREATE OR REPLACE FUNCTION sync_invoice_number_counters() RETURNS void LANGUAGE sql AS $$
  INSERT INTO invoice_number_counters AS c (year, last_value)
  SELECT (m[1])::integer, MAX((m[2])::bigint)
  FROM invoices, regexp_match(invoice_number, '^INV-(\d{4})-(\d{1,6})$') AS m
  GROUP BY 1
  ON CONFLICT (year) DO UPDATE SET last_value = GREATEST(c.last_value, EXCLUDED.last_value);
$$;

SELECT sync_invoice_number_counters();
