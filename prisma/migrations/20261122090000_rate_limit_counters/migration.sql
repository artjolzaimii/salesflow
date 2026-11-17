-- Phase 6C: shared rate-limit counters (version-controlled; never apply by hand).
--
-- Fixed-window counters used by src/server/rate-limit.ts so limits hold across
-- every application instance (no in-memory counters). bucket_key is the SHA-256
-- of "<limit name>:<subject>" (a session, a client IP), so no address or token
-- is stored. Old windows are deleted by the application as it goes.

-- CreateTable
CREATE TABLE "rate_limit_counters" (
    "bucket_key" VARCHAR(64) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("bucket_key","window_start")
);

-- CreateIndex
CREATE INDEX "rate_limit_counters_window_start_idx" ON "rate_limit_counters"("window_start");

ALTER TABLE rate_limit_counters ADD CONSTRAINT rate_limit_counters_count_positive CHECK (count > 0);
