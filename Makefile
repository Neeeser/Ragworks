.PHONY: help env env-backend env-frontend postgres server frontend run test test-verbose coverage coverage-report coverage-open lint

UV ?= uv
NPM ?= npm
UV_SYNC_FLAGS ?= --locked
PYTHON ?=
UV_PYTHON_FLAG := $(if $(PYTHON),-p $(PYTHON),)

API_HOST ?= 127.0.0.1
API_PORT ?= 8000
NEXT_PUBLIC_API_BASE_URL ?= http://$(API_HOST):$(API_PORT)

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
	@echo "  make coverage  - pytest + missing lines + html report"
	@echo "  make coverage-report - same, but never fails"
	@echo "  make coverage-open - open htmlcov/index.html"
	@echo "  make lint      - run pylint on backend code"

env: env-backend env-frontend

env-backend:
	$(UV) sync $(UV_SYNC_FLAGS) $(UV_PYTHON_FLAG)

env-frontend:
	$(NPM) --prefix frontend install

postgres: env-backend
	$(UV) run python scripts/ensure_postgres.py

server: postgres
	$(UV) run uvicorn app.api.main:app --reload --host $(API_HOST) --port $(API_PORT)

frontend: env-frontend
	NEXT_PUBLIC_API_BASE_URL="$(NEXT_PUBLIC_API_BASE_URL)" $(NPM) --prefix frontend run dev

run:
	$(MAKE) -j2 server frontend

test: postgres
	$(UV) run pytest

test-verbose: postgres
	$(UV) run pytest -vv --durations=0

coverage: postgres
	$(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-report: postgres
	-$(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-open:
	@test -f htmlcov/index.html && open htmlcov/index.html || (echo "No report found. Run: make coverage" && exit 1)

lint: env-backend
	$(UV) run pylint --score=y app
