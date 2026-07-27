"""Regression: the per-test database copy self-heals a dropped template.

The template database has no connections between copies, so a concurrent
process (an older harness revision's sweep, or a manual cleanup) can drop it
mid-run — "in use" protection never applies. `reset_database` must rebuild
the template and retry instead of erroring every remaining test in the run.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlmodel import Session

from tests.utils import db as testdb


def test_reset_database_rebuilds_a_dropped_template(session: Session) -> None:
    admin = testdb._admin_engine()
    template = testdb.template_database_name()
    try:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{template}" WITH (FORCE)'))
    finally:
        admin.dispose()

    engine = testdb.create_test_engine()
    try:
        testdb.reset_database(engine)  # must rebuild the template, not raise
        with engine.connect() as connection:
            assert connection.execute(text("SELECT count(*) FROM users")).scalar() == 0
    finally:
        engine.dispose()
