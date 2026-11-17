-- Phase 6B: user administration, password management, TOTP MFA and the security audit log.
-- Version-controlled; never apply by hand.
--
-- users
--   mfa_enabled / mfa_secret       TOTP secret, AES-256-GCM encrypted by the application (never plaintext).
--   mfa_pending_secret             secret generated at setup, active only after a verified code.
--   mfa_last_counter               last accepted TOTP time step: a code can't be replayed.
--   password_changed_at            set on every password change or reset.
--   must_change_password           set when an administrator chose the password (employee screen);
--                                  the user must change it before using the application.
-- auth_sessions.user_agent / ip_address   shown in session lists (truncated, informational).
-- mfa_recovery_codes      single-use codes, stored as keyed SHA-256 hashes; used_at marks a used code.
-- password_reset_tokens   single-use, expiring links for account setup and administrator resets,
--                         stored as SHA-256 hashes (the link itself is shown once, never stored).
-- security_audit_events   append-only (trigger): who did what to which account, when. Never
--                         contains passwords, MFA secrets, recovery codes or reset links.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_enabled_at" TIMESTAMP(3),
ADD COLUMN     "mfa_last_counter" BIGINT,
ADD COLUMN     "mfa_pending_secret" TEXT,
ADD COLUMN     "mfa_secret" TEXT,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "password_changed_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "ip_address" VARCHAR(64),
ADD COLUMN     "user_agent" VARCHAR(200);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(20) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_audit_events" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" VARCHAR(60) NOT NULL,
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "security_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_used_at_idx" ON "mfa_recovery_codes"("user_id", "used_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_user_id_code_hash_key" ON "mfa_recovery_codes"("user_id", "code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_used_at_idx" ON "password_reset_tokens"("user_id", "used_at");

-- CreateIndex
CREATE INDEX "security_audit_events_target_user_id_created_at_idx" ON "security_audit_events"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_audit_events_created_at_idx" ON "security_audit_events"("created_at");

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_audit_events" ADD CONSTRAINT "security_audit_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Constraints the application relies on -----------------------------------------
ALTER TABLE users ADD CONSTRAINT users_mfa_secret_when_enabled CHECK (NOT mfa_enabled OR mfa_secret IS NOT NULL);
ALTER TABLE password_reset_tokens
  ADD CONSTRAINT password_reset_tokens_purpose CHECK (purpose IN ('SETUP', 'RESET')),
  ADD CONSTRAINT password_reset_tokens_expiry CHECK (expires_at > created_at);
ALTER TABLE security_audit_events
  ADD CONSTRAINT security_audit_events_details_object CHECK (jsonb_typeof(details) = 'object'),
  ADD CONSTRAINT security_audit_events_type_format CHECK (event_type ~ '^[A-Z][A-Z_]{2,59}$');

-- The audit log is append-only.
CREATE OR REPLACE FUNCTION guard_security_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Security audit events are append-only';
END $$;
CREATE TRIGGER security_audit_events_append_only BEFORE UPDATE OR DELETE ON security_audit_events
  FOR EACH ROW EXECUTE FUNCTION guard_security_audit_event();
