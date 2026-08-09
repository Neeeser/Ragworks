.PHONY: help env env-backend env-frontend postgres server frontend run test test-clean-templates clean-worktree-dbs test-verbose test-lastfailed test-frontend coverage coverage-report coverage-open coverage-frontend coverage-report-frontend coverage-open-frontend typecheck lint verify verify-fast verify-frontend gate ci-watch lint-frontend format-frontend format-check-frontend readme-assets refresh-openai-bundle sandbox-up sandbox-restart sandbox-down sandbox-list sandbox-flows bump-patch bump-minor bump-major bump-rc

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
DB_GOALS := run server postgres postgres-test test test-verbose test-lastfailed coverage coverage-report verify verify-fast test-clean-templates clean-worktree-dbs
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
	@echo "  make clean-worktree-dbs - drop this worktree's test + sandbox databases"
	@echo "  make test-clean-templates - drop stale schema templates (nothing running)"
	@echo "  make coverage  - pytest + missing lines + html report (the gate's test stage)"
	@echo "  make coverage-report - same, but never fails"
	@echo "  make coverage-open - open htmlcov/index.html"
	@echo "  make coverage-frontend - frontend coverage (vitest)"
	@echo "  make coverage-report-frontend - frontend coverage, never fails"
	@echo "  make coverage-open-frontend - open frontend/coverage/index.html"
	@echo "  make typecheck - run mypy on app/ and sandbox/"
	@echo "  make lint      - run ruff on backend code"
	@echo "  make sandbox-up    - seed a sandbox scenario + start servers (SCENARIO=collection-ready)"
	@echo "  make sandbox-down  - stop the sandbox servers"
	@echo "  make sandbox-list  - list sandbox scenarios (see docs/sandbox.md)"
	@echo "  make sandbox-flows - run saved browser flows against seeded scenarios"
	@echo "  make verify    - typecheck -> lint -> test+coverage (the backend gate, one suite run)"
	@echo "  make verify-fast - typecheck -> lint -> only previously failing tests (red-gate loop)"
	@echo "  make verify-frontend - the frontend gate: npm run verify + prettier check"
	@echo "  make gate      - backend + frontend gates in parallel (logs: gate-backend.log, gate-frontend.log)"
	@echo "  make ci-watch PR=123 - wait for a PR's checks to settle (gh pr checks --watch)"
	@echo "  make sandbox-restart - restart the sandbox backend only (code reload, no reseed)"
	@echo "  make lint-frontend - run eslint on frontend code"
	@echo "  make format-frontend - run prettier on frontend code"
	@echo "  make format-check-frontend - check prettier formatting on frontend code"
	@echo "  make readme-assets - regenerate the README pipeline animation"
	@echo "  make bump-patch|bump-minor|bump-major|bump-rc - open a release PR (merge it to publish; HIGHLIGHTS=\"...\" pre-fills release notes)"

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

test-clean-templates: postgres-test
	@# Schema templates are keyed by schema hash, so branches accumulate them.
	@# Never swept during a run: another worktree's live run may own one.
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run python -c "from tests.utils.db import drop_stale_templates; print(drop_stale_templates())"

clean-worktree-dbs: postgres-test
	@# This worktree's test + sandbox databases only, by derived key rather
	@# than a glob, so it cannot reach a neighbouring worktree's run.
	TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run python scripts/clean_worktree_databases.py

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
	$(UV) run mypy app sandbox

lint: env-backend
	$(UV) run ruff check app tests sandbox

# The gate's test stage runs *with* coverage so the suite executes once, not
# twice. `make test` stays plain for the fast tier and targeted runs.
verify: typecheck lint coverage

# The red-gate loop: after a failed `make verify`, iterate with verify-fast
# (typecheck + lint + only the tests pytest recorded as failing), then run the
# full gate once more when it comes back green. Exit 5 means pytest collected
# nothing — no recorded failures — which counts as green here.
test-lastfailed: postgres-test
	@TEST_DATABASE_URL="$(TEST_DATABASE_URL)" $(UV) run pytest --lf --last-failed-no-failures none \
		|| { code=$$?; [ $$code -eq 5 ] && echo "no previously failing tests recorded"; [ $$code -eq 5 ]; }

verify-fast: typecheck lint test-lastfailed

verify-frontend: env-frontend
	$(NPM) --prefix frontend run verify
	$(NPM) --prefix frontend run format:check

# Both full gates at once, each to its own log, so wall time is the slower
# side alone instead of the sum. Grep the logs; never rerun to reread.
gate:
	@rm -f gate-backend.log gate-frontend.log gate-backend.exit gate-frontend.exit
	@echo "running backend + frontend gates in parallel …"
	@( $(MAKE) verify >gate-backend.log 2>&1; echo $$? >gate-backend.exit ) & \
	( $(MAKE) verify-frontend >gate-frontend.log 2>&1; echo $$? >gate-frontend.exit ) & \
	wait
	@fail=0; for side in backend frontend; do \
		code=$$(cat gate-$$side.exit); rm -f gate-$$side.exit; \
		if [ "$$code" -eq 0 ]; then echo "$$side gate: green (gate-$$side.log)"; \
		else echo "$$side gate: RED, exit $$code (gate-$$side.log)"; fail=1; fi; \
	done; exit $$fail

# Foreground CI wait with a defined end: exits when checks settle or one fails.
ci-watch:
	@test -n "$(PR)" || { echo "usage: make ci-watch PR=123"; exit 1; }
	gh pr checks $(PR) --watch --fail-fast

# Sandbox scenario harness (docs/sandbox.md). The CLI manages its own
# database (ragworks_sandbox), storage, and server lifecycle under .sandbox/.
SCENARIO ?= collection-ready

sandbox-up: env
	$(UV) run python -m sandbox up $(SCENARIO)

sandbox-restart: env-backend
	$(UV) run python -m sandbox restart

sandbox-down: env-backend
	$(UV) run python -m sandbox down

sandbox-list: env-backend
	$(UV) run python -m sandbox list

sandbox-flows: env
	$(UV) run python -m sandbox flows

lint-frontend: env-frontend
	$(NPM) --prefix frontend run lint

format-frontend: env-frontend
	$(NPM) --prefix frontend run format

format-check-frontend: env-frontend
	$(NPM) --prefix frontend run format:check

# SCENE / THEME narrow the capture for iteration (comma-separated scene ids,
# `light`/`dark`); a narrowed run writes previews under frontend/.capture-preview
# instead of docs/assets so a partial animation can never be committed.
readme-assets: env-backend env-frontend
	CAPTURE_SCENES="$(SCENE)" CAPTURE_THEMES="$(THEME)" $(NPM) --prefix frontend run docs:capture-pipeline

refresh-openai-bundle:
	node scripts/download-openai-model-bundle.mjs

# HIGHLIGHTS pre-fills the release PR's Highlights section (exported as an env
# var so prose with quotes survives; still editable on the PR before merging):
#   make bump-minor HIGHLIGHTS="This release reworks the frontend console."
export HIGHLIGHTS

bump-patch:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py patch

bump-minor:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py minor

bump-major:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py major

bump-rc:
	UV_BIN="$(UV)" $(UV) run python scripts/bump_version.py rc
