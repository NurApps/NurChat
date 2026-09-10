#!/bin/bash
# NurChat PostgreSQL Backup Script (production relay)
# Usage: ./scripts/backup-postgres.sh
# Keeps last 7 daily backups in backup/ directory.
# Cron example (daily 03:00): 0 3 * * * cd /opt/NurChat && ./scripts/backup-postgres.sh
set -e

BACKUP_DIR="backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/nurchat_pg_${TIMESTAMP}.sql.gz"
MAX_BACKUPS=7

mkdir -p "$BACKUP_DIR"

if ! docker compose ps db 2>/dev/null | grep -q "Up\|running"; then
  echo "Error: postgres container (db) is not running"
  exit 1
fi

# shellcheck disable=SC2046
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-nurchat}" -d "${POSTGRES_DB:-nurchat}" \
  | gzip > "$BACKUP_FILE"

echo "Backup written: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Rotate: keep newest $MAX_BACKUPS
ls -1t "${BACKUP_DIR}"/nurchat_pg_*.sql.gz | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f

echo "Done. Backups kept: $(ls -1 "${BACKUP_DIR}"/nurchat_pg_*.sql.gz 2>/dev/null | wc -l)"
