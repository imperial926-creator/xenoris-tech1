#!/usr/bin/env bash
#
# Database backup wrapper (master spec §60 "Production Deployment":
# `Backups` is its own explicit step in the deploy sequence, and §59
# "Deployment Architecture" — this script is intentionally
# provider-agnostic: it wraps plain `pg_dump` against whatever
# `DATABASE_URL` points at (a managed Postgres instance, self-hosted, or
# local dev), not a specific cloud provider's proprietary backup API).
#
# Usage:
#   ./scripts/backup-db.sh [output-directory]
#
# Reads DATABASE_URL from the environment (export it, or run via
# `env $(cat .env | xargs) ./scripts/backup-db.sh`). Never hard-codes
# credentials — this script has no idea what database it's talking to
# beyond that one connection string.
#
# Produces a timestamped, custom-format (`-Fc`) pg_dump archive — chosen
# over plain SQL because `-Fc` supports parallel restore (`pg_restore -j`)
# and selective table/schema restore, both useful for a production
# database this size. See scripts/restore-db.sh for the matching restore
# path.
#
# This has NOT been run in this sandbox (no live Postgres instance here) —
# review before relying on it. See docs/deployment/backups.md for the full
# backup/restore runbook, retention guidance, and a restore drill checklist.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Export it or source your .env first." >&2
  exit 1
fi

OUTPUT_DIR="${1:-./backups}"
mkdir -p "$OUTPUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT_FILE="${OUTPUT_DIR}/restaurant-platform-${TIMESTAMP}.dump"

echo "Backing up database to ${OUTPUT_FILE} ..."
pg_dump --format=custom --no-owner --no-privileges --file="$OUTPUT_FILE" "$DATABASE_URL"

echo "Backup complete: ${OUTPUT_FILE} ($(du -h "$OUTPUT_FILE" | cut -f1))"
echo ""
echo "To restore, see scripts/restore-db.sh:"
echo "  ./scripts/restore-db.sh ${OUTPUT_FILE}"
