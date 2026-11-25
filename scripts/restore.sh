#!/usr/bin/env bash
# Restores a dump into the production database, replacing its content.
# Usage: scripts/restore.sh backups/<file>.dump
set -euo pipefail
cd "$(dirname "$0")/.."
file="${1:?usage: scripts/restore.sh backups/<file>.dump}"
set -a; . ./.env; set +a
read -r -p "Replace the content of '$POSTGRES_DB' with $file? Type the database name to confirm: " answer
[ "$answer" = "$POSTGRES_DB" ] || { echo "Cancelled."; exit 1; }
scripts/backup.sh before-restore
scripts/compose.sh stop app
scripts/compose.sh exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$file"
scripts/compose.sh start app
