#!/bin/sh
# Gate the backend on the embedded Postgres accepting connections, then bring
# installed extensions up to the versions this image ships — extension
# upgrades ride app releases instead of a database image tag.
set -eu
if [ -n "${DATABASE_URL:-}" ]; then
    echo "postgres | DATABASE_URL set; embedded Postgres disabled"
    exit 0
fi
i=0
until pg_isready -h 127.0.0.1 -U "${POSTGRES_USER}" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge 120 ]; then
        echo "postgres | not accepting connections after 120s" >&2
        exit 1
    fi
    sleep 1
done
psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 \
    -f /etc/s6-overlay/scripts/update-extensions.sql 2>&1 | sed -u 's/^/postgres | /'
