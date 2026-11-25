#!/usr/bin/env bash
# Updates the production instance: pull, dump the database, rebuild, restart.
# Usage: scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env is missing: copy .env.example and fill it (see docs/deployment.md)"; exit 1; }
git pull --ff-only
if scripts/compose.sh ps --status running db 2>/dev/null | grep -q db; then
  scripts/backup.sh pre-deploy
fi
scripts/compose.sh up -d --build
scripts/compose.sh ps
