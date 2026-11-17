-- Phase 6A security hardening (version-controlled; never apply by hand).
--
-- 1. auth_sessions: a server-side record for every sign-in. The Auth.js JWT
--    cookie carries the session id; every request checks that the row exists,
--    belongs to the user, is not revoked and has not expired.
--    - Sign-out revokes the row, so a copied cookie stops working immediately
--      (before: a stateless JWT stayed valid until it expired).
--    - Deactivating an employee or user revokes all of their sessions.
--    - expires_at gives an absolute lifetime (8 h), whatever the cookie says.
--    - A token minted with AUTH_SECRET but without a session row is refused.
--    Existing cookies (issued before this migration) carry no session id and
--    are refused once: users sign in again.
--
-- 2. auth_login_throttle: failed sign-in attempts shared by all server
--    instances (before: in process memory, per instance, unbounded). Keys are
--    SHA-256 hashes ("email:<address>"), so attempted addresses are not stored.

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_login_throttle" (
    "key" VARCHAR(64) NOT NULL,
    "failures" INTEGER NOT NULL,
    "window_started_at" TIMESTAMP(3) NOT NULL,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "auth_login_throttle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_revoked_at_idx" ON "auth_sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_login_throttle_window_started_at_idx" ON "auth_login_throttle"("window_started_at");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_expiry_after_creation CHECK (expires_at > created_at);
ALTER TABLE auth_login_throttle ADD CONSTRAINT auth_login_throttle_failures_positive CHECK (failures > 0);
