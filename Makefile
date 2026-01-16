.PHONY: help env env-backend env-frontend postgres server frontend run test test-verbose test-frontend coverage coverage-report coverage-open coverage-frontend coverage-report-frontend coverage-open-frontend lint lint-frontend format-frontend format-check-frontend

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
	@echo "  make test-frontend - run frontend tests (vitest)"
	@echo "  make coverage  - pytest + missing lines + html report"
	@echo "  make coverage-report - same, but never fails"
	@echo "  make coverage-open - open htmlcov/index.html"
	@echo "  make coverage-frontend - frontend coverage (vitest)"
	@echo "  make coverage-report-frontend - frontend coverage, never fails"
	@echo "  make coverage-open-frontend - open frontend/coverage/index.html"
	@echo "  make lint      - run pylint on backend code"
	@echo "  make lint-frontend - run eslint on frontend code"
	@echo "  make format-frontend - run prettier on frontend code"
	@echo "  make format-check-frontend - check prettier formatting on frontend code"

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

test-frontend: env-frontend
	$(NPM) --prefix frontend run test:run

coverage: postgres
	$(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-report: postgres
	-$(UV) run pytest --cov --cov-report=term-missing:skip-covered --cov-report=html --cov-report=xml

coverage-open:
	@test -f htmlcov/index.html && open htmlcov/index.html || (echo "No report found. Run: make coverage" && exit 1)

coverage-frontend: env-frontend
	$(NPM) --prefix frontend run coverage

coverage-report-frontend: env-frontend
	-$(NPM) --prefix frontend run coverage

coverage-open-frontend:
	@test -f frontend/coverage/index.html && open frontend/coverage/index.html || (echo "No report found. Run: make coverage-frontend" && exit 1)

lint: env-backend
	$(UV) run pylint --score=y app

lint-frontend: env-frontend
	$(NPM) --prefix frontend run lint

format-frontend: env-frontend
	$(NPM) --prefix frontend run format

format-check-frontend: env-frontend
	$(NPM) --prefix frontend run format:check
