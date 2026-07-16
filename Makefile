.PHONY: help env env-backend env-frontend postgres server frontend run test test-verbose test-frontend coverage coverage-report coverage-open coverage-frontend coverage-report-frontend coverage-open-frontend typecheck lint verify lint-frontend format-frontend format-check-frontend readme-assets bump-patch bump-minor bump-major bump-rc

UV ?= uv
NPM ?= npm
UV_SYNC_FLAGS ?= --locked
PYTHON ?=
UV_PYTHON_FLAG := $(if $(PYTHON),-p $(PYTHON),)

# Must stay `localhost` (not 127.0.0.1) to match the frontend origin and the
# CORS default (http://localhost:3000): the refresh cookie is SameSite=Lax, and
# localhost vs 127.0.0.1 are different *sites*, so a 127.0.0.1 API base would
# make the cross-site refresh POST drop the cookie and break persistent login.
API_HOST ?= localhost
API_PORT ?= 8000
NEXT_PUBLIC_API_BASE_URL ?= http://$(API_HOST):$(API_PORT)
# Dev opts into debug mode; the app default is production-safe (DEBUG=false).
DEBUG ?= true

# Dev database resolution — the standard path is a Dockerized ParadeDB
# (pgvector + pg_search, so hybrid/BM25 search works). Docker is required for
# local dev; ensure_postgres.py fails loudly when its daemon is unreachable. An
# explicitly provided DATABASE_URL / TEST_DATABASE_URL (CI service container, a
# contributor pointing at their own server) always wins and is left unmanaged.
# The application and test URLs resolve independently: a server override never
# turns the test URL into an empty value, or vice versa. Only computed for
# DB-touching goals so `make help`/`make lint` skip it.
DB_GOALS := run server postgres postgres-test test test-verbose coverage coverage-report verify
ifneq ($(filter $(DB_GOALS),$(MAKECMDGOALS)),)
  _DATABASE_URL_ORIGIN := $(origin DATABASE_URL)
  _TEST_DATABASE_URL_ORIGIN := $(origin TEST_DATABASE_URL)

  ifneq ($(filter environment command,$(_DATABASE_URL_ORIGIN)),)
    SERVER_DB_MODE := external
  else
    SERVER_DB_MODE := docker
    DATABASE_URL := postgresql+psycopg://ragworks:ragworks@localhost:54329/ragworks
  endif

  ifneq ($(filter environment command,$(_TEST_DATABASE_URL_ORIGIN)),)
    TEST_DB_MODE := external
  else
    TEST_DB_MODE := docker
    TEST_DATABASE_URL := postgresql+psycopg://ragworks:ragworks@localhost:54329/ragworks_test
  endif
endif

help:
	@echo "Targets:"
	@echo "  make env       - create venv + install backend/frontend deps"
	@echo "                 - optional: make env PYTHON=3.12"
	@echo "  make env-backend  - install backend deps only"
	@echo "  make env-frontend - install frontend deps only"
	@echo "  make server    - run FastAPI (reload)"
	@echo "  make postgres  - ensure Postgres is running"
	@echo "  make frontend  - run Next.js dev server"
	@echo "  make run       - run server + frontend together"
	@echo "  make test      - run pytest"
	@echo "  make test-verbose - run pytest with verbose output and durations"
	@echo "  make test-frontend - run frontend tests (vitest)"
	@echo "  make coverage  - pytest + missing lines + html report"
	@echo "  make coverage-report - same, but never fails"
	@echo "  make coverage-open - open htmlcov/index.html"
	@echo "  make coverage-frontend - frontend coverage (vitest)"
	@echo "  make coverage-report-frontend - frontend coverage, never fails"
	@echo "  make coverage-open-frontend - open frontend/coverage/index.html"
	@echo "  make typecheck - run mypy on app/"
	@echo "  make lint      - run ruff + pylint on backend code"
	@echo "  make verify    - typecheck -> lint -> test (the backend gate)"
	@echo "  make lint-frontend - run eslint on frontend code"
	@echo "  make format-frontend - run prettier on frontend code"
	@echo "  make format-check-frontend - check prettier formatting on frontend code"
	@echo "  make readme-assets - regenerate the README pipeline animation"
	@echo "  make bump-patch|bump-minor|bump-major|bump-rc - open a release PR (merge it to publish)"

env: env-backend env-frontend

env-backend:
	$(UV) sync $(UV_SYNC_FLAGS) $(UV_PYTHON_FLAG)

env-frontend:
	$(NPM) --prefix frontend install

postgres: env-backend
	DB_MODE="$(SERVER_DB_MODE)" DATABASE_URL="$(DATABASE_URL)" $(UV) run python scripts/ensure_postgres.py

postgres-test: env-backend
	DB_MODE="$(TEST_DB_MODE)" DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run python scripts/ensure_postgres.py

server: postgres
	DEBUG="$(DEBUG)" DATABASE_URL="$(DATABASE_URL)" $(UV) run uvicorn app.api.main:app --reload --host $(API_HOST) --port $(API_PORT)

frontend: env-frontend
	NEXT_PUBLIC_API_BASE_URL="$(NEXT_PUBLIC_API_BASE_URL)" $(NPM) --prefix frontend run dev

run:
	$(MAKE) -j2 server frontend

test: postgres-test
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run pytest

test-verbose: postgres-test
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run pytest -vv --durations=0

test-frontend: env-frontend
	$(NPM) --prefix frontend run test:run

coverage: postgres-test
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-report: postgres-test
	-TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-open:
	@test -f htmlcov/index.html && open htmlcov/index.html || (echo "No report found. Run: make coverage" && exit 1)

coverage-frontend: env-frontend
	$(NPM) --prefix frontend run coverage

coverage-report-frontend: env-frontend
	-$(NPM) --prefix frontend run coverage

coverage-open-frontend:
	@test -f frontend/coverage/index.html && open frontend/coverage/index.html || (echo "No report found. Run: make coverage-frontend" && exit 1)

typecheck: env-backend
	$(UV) run mypy app

lint: env-backend
	$(UV) run ruff check app tests
	$(UV) run pylint --score=y --fail-under=10 app

verify: typecheck lint test

lint-frontend: env-frontend
	$(NPM) --prefix frontend run lint

format-frontend: env-frontend
	$(NPM) --prefix frontend run format

format-check-frontend: env-frontend
	$(NPM) --prefix frontend run format:check

readme-assets: env-backend env-frontend
	$(NPM) --prefix frontend run docs:capture-pipeline

bump-patch:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py patch

bump-minor:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py minor

bump-major:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py major

bump-rc:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py rc
