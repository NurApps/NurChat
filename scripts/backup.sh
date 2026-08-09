#!/bin/bash
# NurChat SQLite Backup Script
# Usage: ./scripts/backup.sh
# Keeps last 7 daily backups in backup/ directory

set -e

BACKUP_DIR="backup"
DB_FILE="nurchat.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/nurchat_${TIMESTAMP}.db"
MAX_BACKUPS=7

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database file exists
if [ ! -f "$DB_FILE" ]; then
    echo "Error: Database file $DB_FILE not found"
    exit 1
fi

# Create backup using SQLite .backup command
if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
else
    # Fallback: copy the file
    cp "$DB_FILE" "$BACKUP_FILE"
fi

echo "Backup created: $BACKUP_FILE"

# Remove old backups (keep last MAX_BACKUPS)
cd "$BACKUP_DIR"
ls -t nurchat_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm
cd ..

echo "Backup completed. Retained last $MAX_BACKUPS backups."
