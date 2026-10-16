#!/usr/bin/env bash
# Creates a new NexHR database in the right order. Run from the package root as a PostgreSQL superuser or the database owner:
#   OWNER_DATABASE_URL=postgres://owner:PASSWORD@HOST:5432/postgres APP_DB_PASSWORD='...' bash database/setup_database.sh [--with-demo]
set -euo pipefail
cd "$(dirname "$0")"
: "${OWNER_DATABASE_URL:?Set OWNER_DATABASE_URL to a connection string for the database owner}"
: "${APP_DB_PASSWORD:?Set APP_DB_PASSWORD to the password for the nexyra_app role}"
DB_NAME="${DB_NAME:-nexhr}"

psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 \
  || psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME"
TARGET="${OWNER_DATABASE_URL%/*}/$DB_NAME"

psql "$TARGET" -v ON_ERROR_STOP=1 -f schema.sql
psql "$TARGET" -v ON_ERROR_STOP=1 -f indexes.sql
psql "$TARGET" -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -f rls_and_roles.sql
if [ "${1:-}" = "--with-demo" ]; then psql "$TARGET" -v ON_ERROR_STOP=1 -f seed.sql; fi

echo "Database $DB_NAME is ready. In server/.env set:"
echo "DATABASE_URL=postgres://nexyra_app:<APP_DB_PASSWORD>@<host>:5432/$DB_NAME"
