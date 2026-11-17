-- Phase 5B: two nullable columns the designed screens already show (customer notes,
-- employee territory). Additive; no existing data is touched.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "territory" VARCHAR(150);

