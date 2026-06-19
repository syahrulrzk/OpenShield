#!/usr/bin/env bash
# scripts/db-push-safe.sh
#
# Safe wrapper around `prisma db push` that:
#   1. Backups users + audit_logs (yang paling penting buat dipreserve)
#      sebelum destructive schema changes.
#   2. Runs `prisma db push`.
#   3. If --force-reset was needed, restores the backup afterward.
#
# Usage:
#   ./scripts/db-push-safe.sh              # normal push, no reset
#   ./scripts/db-push-safe.sh --force-reset # when schema drift forces reset
#
# Why: Prisma 6 sometimes hits a constraint-rename bug with multiple
# @relation declarations on the same FK field, forcing --force-reset
# which wipes users. This script keeps at least users+audit intact.

set -euo pipefail

cd "$(dirname "$0")/.."

FORCE_RESET=""
if [[ "${1:-}" == "--force-reset" ]]; then
  FORCE_RESET="--force-reset"
  echo "⚠️  --force-reset di-request. Akan backup dulu sebelum push."
fi

BACKUP_FILE="/tmp/openshield_db_push_backup_$(date +%s).sql"

echo "📦 Backup users + audit_logs → $BACKUP_FILE"
docker exec openshield-postgres pg_dump \
  -U openshield -d openshield \
  --data-only --inserts \
  --table=users --table=refresh_tokens --table=audit_logs \
  > "$BACKUP_FILE" 2>/dev/null || true
echo "   $(grep -c 'INSERT INTO' "$BACKUP_FILE" || echo 0) rows backed up"

echo "🔄 prisma db push ${FORCE_RESET}"
unset NODE_ENV
npx prisma db push $FORCE_RESET --skip-generate
npx prisma generate

if [[ -n "$FORCE_RESET" ]]; then
  echo "♻️  Restoring backup..."
  docker exec -i openshield-postgres psql -U openshield -d openshield \
    < "$BACKUP_FILE" > /dev/null
  RESTORED=$(docker exec openshield-postgres psql -U openshield -d openshield -tAc \
    "SELECT COUNT(*) FROM users" 2>/dev/null || echo "?")
  echo "   users restored: $RESTORED"
fi

echo "✅ Done. Backup kept di: $BACKUP_FILE"
