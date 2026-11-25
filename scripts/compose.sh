#!/usr/bin/env bash
# Runs docker compose with the production files. Used by the other scripts.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile stack "$@"
