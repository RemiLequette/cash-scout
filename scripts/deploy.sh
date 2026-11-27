#!/usr/bin/env bash
# Installs a release on the production instance: dump the database, check out
# its tag, rebuild, restart. Releases are made with scripts/release.ps1.
# Usage: scripts/deploy.sh [vX.Y.Z]    (default: the latest release)
set -euo pipefail

main() {
  cd "$(dirname "$0")/.."
  [ -f .env ] || { echo ".env is missing: copy .env.example and fill it (see docs/deployment.md)"; exit 1; }

  git fetch --quiet --tags origin
  local tag="${1:-}"
  if [ -z "$tag" ]; then
    tag=$(git for-each-ref --count=1 --sort=-version:refname --format='%(refname:short)' 'refs/tags/v[0-9]*')
    [ -n "$tag" ] || { echo "No release yet: make one with scripts/release.ps1"; exit 1; }
  elif ! git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null; then
    echo "No release $tag"
    exit 1
  fi

  local before
  before=$(git describe --tags --match 'v[0-9]*' 2>/dev/null || git rev-parse --short HEAD)
  echo "Deploying $tag (checked out: $before)"

  if scripts/compose.sh ps --status running db 2>/dev/null | grep -q db; then
    scripts/backup.sh pre-deploy
  fi
  git checkout --quiet --detach "refs/tags/$tag"
  APP_VERSION="${tag#v}" scripts/compose.sh up -d --build
  scripts/compose.sh ps
  echo "Deployed $tag"
}

# One line: bash has read it whole before the checkout replaces this file.
main "$@"; exit
