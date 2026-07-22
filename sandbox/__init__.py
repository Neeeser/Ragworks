"""Sandbox scenario harness: seed named application states for end-to-end testing.

Entry point: ``uv run python -m sandbox`` (see ``docs/sandbox.md``). Modules
under this package import ``app.*`` service code, so the CLI applies the sandbox
environment (`sandbox.config.apply_backend_env`) before importing them —
``app.db.engine`` binds ``DATABASE_URL`` at import time.
"""
