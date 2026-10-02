#!/usr/bin/env bash
#
# Database restore wrapper — the matching counterpart to
# scripts/backup-db.sh. Restores a custom-format pg_dump archive into
# whatever database DATABASE_URL currently points at.
#
# Usage:
#   ./scripts/restore-db.sh path/to/restaurant-platform-<timestamp>.dump
#
# DESTRUCTIVE: this drops and recreates every object pg_restore's
# `--clean --if-exists` touches in the target database before restoring.
# Never point DATABASE_URL at production while testing a restore — restore
# into a scratch database first (see docs/deployment/backups.md's restore
# drill checklist) unless this restore IS the intended disaster-recovery
# action.
#
# This has NOT been run in this sandbox (no live Postgres instance here) —
# review before relying on it.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Export it or source your .env first." >&2
  exit 1
fi

DUMP_FILE="${1:-}"
if [[ -z "$DUMP_FILE" ]]; then
  echo "Usage: $0 <path-to-dump-file>" >&2
  exit 1
fi
if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "About to restore ${DUMP_FILE} into:"
echo "  ${DATABASE_URL}"
echo ""
echo "This will DROP existing objects in the target database (pg_restore --clean --if-exists)."
read -r -p "Type the database name to confirm: " CONFIRM
TARGET_DB="$(echo "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
if [[ "$CONFIRM" != "$TARGET_DB" ]]; then
  echo "Confirmation did not match target database name (${TARGET_DB}). Aborting." >&2
  exit 1
fi

echo "Restoring ..."
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$DUMP_FILE"

echo "Restore complete."
