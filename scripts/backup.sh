#!/usr/bin/env bash
# Dumps the production database to backups/ (custom format) and prunes old dumps.
# Usage: scripts/backup.sh [label]      Cron: 15 3 * * * /path/to/cash-scout/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p backups
file="backups/$(date +%Y%m%d-%H%M%S)${1:+-$1}.dump"
scripts/compose.sh exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$file.tmp"
mv "$file.tmp" "$file"
find backups -name '*.dump' -mtime "+$KEEP_DAYS" -delete
echo "Backup written: $file ($(du -h "$file" | cut -f1))"
