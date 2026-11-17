#!/usr/bin/env bash
# Restores a backup into a NEW, EMPTY database and verifies it (docs/deployment.md § Restore).
# Never point this at the live database. Usage:
#   RESTORE_DATABASE_URL=postgresql://…/salesflow_restore_check?sslmode=require scripts/db/restore-check.sh backups/salesflow-….dump
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to an empty scratch database}"
dump="${1:?Pass the .dump file}"
existing="$(psql "$RESTORE_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
if [ "$existing" != "0" ]; then echo "Refusing: the target database is not empty." >&2; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$dump"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify.sql
psql "$RESTORE_DATABASE_URL" -Atc "SELECT 'migrations applied: ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
echo "Restore check passed: $dump"
