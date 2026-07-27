"""Regression: the per-test database copy self-heals a dropped template.

The template database has no connections between copies, so a concurrent
process (a cleanup command, a run on another branch) can drop it mid-run —
"in use" protection never applies. `reset_database` must rebuild the template
and retry instead of erroring every remaining test in the run.

The test drops a *throwaway* template name rather than the live one: the
template is keyed by schema hash, so every worker in this run — and any run
in another worktree on the same schema — shares it, and dropping the real one
breaks them.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlmodel import Session

from tests.utils import db as testdb


def test_reset_database_rebuilds_a_dropped_template(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    throwaway = f"ragworks_tmpl_probe_{uuid4().hex[:8]}"
    monkeypatch.setattr(testdb, "template_database_name", lambda: throwaway)
    monkeypatch.setattr(testdb, "_template_ready", False)

    engine = testdb.create_test_engine()
    admin = testdb._admin_engine()
    try:
        testdb.reset_database(engine)  # builds the throwaway template
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{throwaway}" WITH (FORCE)'))

        testdb.reset_database(engine)  # must rebuild it, not raise

        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 0
    finally:
        engine.dispose()
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{throwaway}" WITH (FORCE)'))
        admin.dispose()
