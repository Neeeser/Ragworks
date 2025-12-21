# Project

TransparentRAG is a FastAPI backend (`app/`) with a Next.js frontend (`frontend/`).
The goal of this project is to provide an easy to use RAG interface for power users.
It's backbones are pinecone for vector storage and Openrouter for Embeddings and LLMs.

# Make Commands

- `make env`: install backend deps via `uv` and frontend deps via `npm`
- `make server`: run FastAPI with reload (`uvicorn app.api.main:app`)
- `make frontend`: run Next.js dev server (sets `NEXT_PUBLIC_API_BASE_URL`)
- `make run`: run backend + frontend together
- `make test`: run backend tests (`pytest`)
- `make coverage`: run tests with coverage (terminal missing-lines + `htmlcov/` + `coverage.xml`)
- `make coverage-report`: like `make coverage`, but does not fail the Make target if tests fail
- `make coverage-open`: open `htmlcov/index.html`

# Backend Tests and Coverage

- Prefer adding/adjusting tests alongside new backend code.
- Before finishing your work on a backend change:
  - Run `make test` (or `make coverage-report` while iterating)
  - Run `make coverage` and review the terminal `term-missing` output
  - Always run these before sending your final response
- Check for untested code and add tests as needed.

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
