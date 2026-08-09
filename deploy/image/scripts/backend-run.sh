#!/bin/sh
# Loopback bind: the backend is reachable only through the frontend's
# same-origin /api proxy; nothing outside the container sees port 8000.
set -eu
export DATABASE_URL="${DATABASE_URL:-postgresql+psycopg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}}"
cd /app
exec /app/.venv/bin/uvicorn app.api.main:app --host 127.0.0.1 --port 8000
