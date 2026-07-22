#!/bin/sh
set -eu

database_file="$(mktemp /tmp/livejobindex-migrations-XXXXXX.db)"
trap 'rm -f "$database_file"' EXIT

for migration in migrations/*.sql; do
  sqlite3 "$database_file" < "$migration"
done

foreign_key_failures="$(sqlite3 "$database_file" 'PRAGMA foreign_key_check;')"
if [ -n "$foreign_key_failures" ]; then
  printf '%s\n' "$foreign_key_failures" >&2
  exit 1
fi

table_count="$(sqlite3 "$database_file" "SELECT count(*) FROM sqlite_master WHERE type = 'table';")"
if [ "$table_count" -lt 50 ]; then
  printf 'missing_tables: expected at least 50, found %s\n' "$table_count" >&2
  exit 1
fi
printf 'migrations_ok (%s tables)\n' "$table_count"
