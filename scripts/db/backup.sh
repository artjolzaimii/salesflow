#!/usr/bin/env bash
# Logical backup of the SalesFlow database (docs/deployment.md § Backups).
# A complement to the managed provider's automated backups / point-in-time recovery,
# e.g. before a risky release. Usage:
#   BACKUP_DATABASE_URL=postgresql://…?sslmode=require scripts/db/backup.sh [output-dir]
# The URL comes from the environment (a read-only or migrator role), never from this file.
set -euo pipefail
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL}"
out_dir="${1:-./backups}"
mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$out_dir/salesflow-$stamp.dump"
# Custom format: compressed, restorable table by table, includes triggers and functions.
pg_dump --format=custom --no-owner --no-privileges --file="$file" "$BACKUP_DATABASE_URL"
pg_restore --list "$file" > /dev/null   # the archive is readable
sha256sum "$file" 2>/dev/null || shasum -a 256 "$file"
echo "Backup written: $file"
