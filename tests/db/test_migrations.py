"""Pure-function contract tests for `app.db.migrations`.

Deliberately narrow: this module used to also carry SQL-string-echo tests
(asserting that a function's stub-connection log contained expected DDL
substrings) and orchestration tests that monkeypatched `_constraint_signature`
to force a code path — both were testing the mock, not migrations behavior,
and were deleted (see task-7.1-report.md for the full list). The orchestration
functions they exercised (`apply_missing_columns`, `ensure_indexes`,
`ensure_foreign_keys`) get real coverage against live Postgres in
`tests/db/test_bootstrap.py`. What remains here are the pure helpers where a
wrong answer is a real bug: identifier truncation (Postgres' 63-char limit),
default-value resolution (including enum defaults), and FK ON DELETE/UPDATE
clause construction.
"""

from __future__ import annotations

from enum import Enum
from types import SimpleNamespace

from sqlalchemy import Column, ForeignKeyConstraint, Integer, MetaData, String, Table, text
from sqlalchemy.dialects.sqlite import dialect as sqlite_dialect

from app.db import migrations


def test_resolve_default_sql_handles_server_default() -> None:
    column = Column("flag", Integer, server_default=text("1"))
    default_sql, drop_default = migrations._resolve_default_sql(
        column, sqlite_dialect(), allow_application_default=True
    )

    assert default_sql is not None
    assert drop_default is False


def test_resolve_default_sql_quotes_plain_string_server_default() -> None:
    """A plain-string `server_default=` is a scalar literal, not raw SQL text.

    SQLAlchemy's own `CREATE TABLE` compiler quotes it (`DEFAULT 'user'`);
    emitting it unquoted (`DEFAULT user`) is valid SQL but wrong -- Postgres
    parses the bare identifier `user` as the `CURRENT_USER` function, so
    backfilled rows get the connecting role's name instead of the literal
    string "user".
    """
    column = Column("role", String, server_default="user")
    default_sql, drop_default = migrations._resolve_default_sql(
        column, sqlite_dialect(), allow_application_default=True
    )

    assert default_sql == "'user'"
    assert drop_default is False


def test_resolve_default_sql_handles_enum_default() -> None:
    class _Status(Enum):
        ACTIVE = "active"

    column = Column("status", String, default=_Status.ACTIVE, nullable=False)
    default_sql, drop_default = migrations._resolve_default_sql(
        column, sqlite_dialect(), allow_application_default=True
    )

    assert "active" in (default_sql or "")
    assert drop_default is True


def test_missing_warning_columns_backfill_empty_json_lists() -> None:
    assert migrations._missing_column_default("documents", "warnings") == ("'[]'", True)
    assert migrations._missing_column_default("pipeline_runs", "warnings") == ("'[]'", True)
    assert migrations._missing_column_default("documents", "unrelated") == (None, False)


def test_foreign_key_name_truncates_long_identifiers() -> None:
    name = migrations._foreign_key_name("t" * 40, ("col" * 10,), "r" * 40)

    assert len(name) <= 63
    assert name.startswith("fk_")


def test_foreign_key_ddl_includes_ondelete_onupdate() -> None:
    metadata = MetaData()
    Table("parent", metadata, Column("id", Integer, primary_key=True))
    child = Table(
        "child",
        metadata,
        Column("parent_id", Integer),
        ForeignKeyConstraint(
            ["parent_id"],
            ["parent.id"],
            ondelete="CASCADE",
            onupdate="RESTRICT",
        ),
    )
    constraint = next(iter(child.foreign_key_constraints))
    signature = migrations._constraint_signature(constraint)
    ddl = migrations._foreign_key_ddl(
        sqlite_dialect().identifier_preparer,
        child.name,
        "fk_child_parent",
        signature,
        constraint,
    )

    assert "ON DELETE CASCADE" in ddl
    assert "ON UPDATE RESTRICT" in ddl


def test_constraint_delete_update_helpers_handle_empty_elements() -> None:
    dummy = SimpleNamespace(elements=[])

    assert migrations._constraint_ondelete(dummy) is None
    assert migrations._constraint_onupdate(dummy) is None


def test_table_is_empty_detects_rows() -> None:
    class _StubConnection:
        def __init__(self, execute) -> None:
            self.execute = execute

    class _HasRow:
        def first(self_inner):
            return (1,)

    class _Empty:
        def first(self_inner):
            return None

    empty_conn = _StubConnection(lambda *_args, **_kwargs: _Empty())
    assert migrations._table_is_empty(empty_conn, sqlite_dialect().identifier_preparer, "table") is True

    row_conn = _StubConnection(lambda *_args, **_kwargs: _HasRow())
    assert migrations._table_is_empty(row_conn, sqlite_dialect().identifier_preparer, "table") is False
