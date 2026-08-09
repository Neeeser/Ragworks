# syntax=docker/dockerfile:1
# All-in-one release image: embedded ParadeDB Postgres + FastAPI backend +
# Next.js frontend supervised by s6-overlay. Publishing one image keeps the
# app and its exact database version as a single tested unit — the pg_search
# feature set (BM25, faceting) tracks app releases instead of a user-editable
# database image tag.

FROM python:3.12-slim AS backend-build
COPY --from=ghcr.io/astral-sh/uv:0.7 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
# package = false in [tool.uv], so this installs dependencies only.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend .
# Built WITHOUT NEXT_PUBLIC_API_BASE_URL: the bundle uses same-origin /api
# paths, proxied at runtime via the API_PROXY_TARGET middleware
# (see frontend/src/middleware.ts).
RUN npm run build

FROM paradedb/paradedb:v0.24.3-pg17
ARG S6_OVERLAY_VERSION=3.2.0.2
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends xz-utils libstdc++6 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# s6-overlay: noarch scripts + arch binaries.
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp/
RUN case "${TARGETARCH}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac \
    && curl -fsSL -o /tmp/s6-overlay-arch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" \
    && tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz \
    && tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz \
    && rm /tmp/s6-overlay-*.tar.xz

# CPython 3.12 (the venv's interpreter) and the Node runtime; the base image's
# /usr/local is empty so the copy cannot clobber Postgres files.
COPY --from=python:3.12-slim /usr/local /usr/local
COPY --from=node:22-bookworm-slim /usr/local/bin/node /usr/local/bin/node
RUN ldconfig

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /data/storage /data/config \
    && chown -R appuser:appuser /data

COPY --from=backend-build /app/.venv /app/.venv
COPY app /app/app
COPY --from=frontend-build --chown=appuser:appuser /app/.next/standalone /app/frontend
COPY --from=frontend-build --chown=appuser:appuser /app/.next/static /app/frontend/.next/static
COPY --from=frontend-build --chown=appuser:appuser /app/public /app/frontend/public

COPY deploy/image/s6-rc.d /etc/s6-overlay/s6-rc.d
COPY deploy/image/scripts /etc/s6-overlay/scripts
RUN chmod +x /etc/s6-overlay/scripts/*.sh /etc/s6-overlay/s6-rc.d/*/run

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    FILE_STORAGE_PATH=/data/storage \
    CONFIG_PATH=/data/config \
    API_PROXY_TARGET=http://127.0.0.1:8000 \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    POSTGRES_USER=ragworks \
    POSTGRES_PASSWORD=ragworks \
    POSTGRES_DB=ragworks \
    S6_KEEP_ENV=1 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

# The postgres base image sets STOPSIGNAL SIGINT; s6-overlay's init expects
# SIGTERM to run its shutdown sequence (which delivers each service its own
# stop signal), so restore the default.
STOPSIGNAL SIGTERM

VOLUME /var/lib/postgresql/data /data/storage /data/config
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 and urllib.request.urlopen('http://127.0.0.1:3000', timeout=4).status < 500 else 1)"
ENTRYPOINT ["/init"]
