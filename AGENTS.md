# Project

TransparentRAG is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`).
The goal of this project is to provide an easy to use RAG interface for power users.
It's backbones are pinecone for vector storage and Openrouter for Embeddings and LLMs.

# External API Documentation

For Pinecone and OpenRouter changes, read the locally downloaded docs in
`external_api_documentation/pinecone-docs/` and `external_api_documentation/openrouter-docs/`
to ensure the most up-to-date behavior and feature availability.

# Make Commands

- `make env`: install backend deps via `uv` and frontend deps via `npm`
- `make server`: run FastAPI with reload (`uvicorn app.api.main:app`)
- `make frontend`: run Next.js dev server (sets `NEXT_PUBLIC_API_BASE_URL`)
- `make run`: run backend + frontend together
- `make test`: run backend tests (`pytest`)
- `make coverage`: run tests with coverage (terminal missing-lines + `htmlcov/` + `coverage.xml`)
- `make coverage-report`: like `make coverage`, but does not fail the Make target if tests fail
- `make coverage-open`: open `htmlcov/index.html`
- `make test-frontend`: run frontend tests (`vitest`)
- `make coverage-frontend`: run frontend coverage (`vitest`)
- `make coverage-report-frontend`: like `make coverage-frontend`, but does not fail the Make target if tests fail
- `make coverage-open-frontend`: open `frontend/coverage/index.html`


# Backend Coding Guidelines

## Data Contracts and Types

- Prefer explicit Pydantic models for request/response bodies, service boundaries, and persistence DTOs.
- Use strong typing throughout the backend (typed function signatures, return types, and attributes).
- Avoid `Any` and runtime type checks (e.g., `isinstance`) as a substitute for clear types and schemas.
- Validate inputs at boundaries so internal code stays on the happy path.

## Modularity and Structure

- Keep code modular: small, focused modules with clear responsibilities.
- Put shared models in dedicated `models` modules/files and reuse them rather than duplicating shapes.
- Organize code into the existing folder structure (`app/api`, `app/services`, `app/db`, `app/schemas`, `app/retrieval`); introduce new folders only when they clarify ownership.

## Style and Readability

- Follow pylint-friendly formatting and conventions; keep code compliant with typical pylint rules.
- Always include docstrings for modules, classes, and functions.
- Add clear, concise comments where behavior is non-obvious to keep code easy to understand.

## Backend Tests and Coverage

- Always add/adjust tests alongside new backend code.
- Before finishing your work on a backend change:
  - Run `make test` (or `make coverage-report` while iterating)
  - Run `make coverage` and review the terminal `term-missing` output
  - Always run these before sending your final response
- Check for untested code and add tests as needed.
- If you only made frontend changes, no need to run backend tests/coverage.

## Backend Linting

- Always run pylint on backend code you change (use `make lint`).
- Fix lint warnings/errors you introduce before sending your final response.

# Frontend Coding Guidelines

## Frontend Linting

- Always run ESLint on frontend code you change (use `make lint-frontend`).
- Fix lint warnings/errors you introduce before sending your final response.

## Frontend Formatting

- Always run Prettier on frontend code you change (use `make format-frontend`).
- Ensure CI-friendly formatting checks pass (use `make format-check-frontend`).

## Frontend Tests and Coverage

- Always add/adjust tests alongside new frontend code.
- Before finishing your work on a frontend change:
  - Run `make test-frontend`
  - Run `make coverage-frontend` and ensure frontend updates meet coverage thresholds
  - Use `make coverage-report-frontend` while iterating if you need a non-blocking run

## Modularity and Structure

- Prefer modular, component-first frontend architecture. Keep `page.tsx` files focused on composition and orchestration, moving UI blocks into reusable components.
- Use subfolders under `frontend/src/components/` to show component hierarchy and keep large views digestible.
- For transient frontend status messages, use the `Notification` component.
