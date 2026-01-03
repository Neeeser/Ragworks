from __future__ import annotations

from contextlib import contextmanager
from enum import Enum
from types import SimpleNamespace

from sqlalchemy import Column, ForeignKeyConstraint, Index, Integer, MetaData, String, Table, text
from sqlalchemy.dialects.sqlite import dialect as sqlite_dialect

from app.db import migrations


class _StubConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement, *args, **kwargs):
        self.statements.append(str(statement))

        class _Result:
            def first(self_inner):
                return None

        return _Result()


class _StubEngine:
    def __init__(self) -> None:
        self.dialect = sqlite_dialect()
        self.connection: _StubConnection | None = None

    @contextmanager
    def begin(self):
        self.connection = _StubConnection()
        yield self.connection


def _fake_metadata(tables: dict[str, Table], sorted_tables: list[Table]):
    return SimpleNamespace(tables=tables, sorted_tables=sorted_tables)


def test_apply_missing_columns_handles_missing_metadata(monkeypatch) -> None:
    metadata = MetaData()
    table = Table("sample", metadata, Column("id", Integer), Column("value", Integer))
    fake_meta = _fake_metadata({"sample": table}, [table])
    engine = _StubEngine()
    calls: list[tuple[str, str]] = []

    def _record(_connection, _table, column, *_args, **_kwargs):
        calls.append((_table.name, column.name))

    monkeypatch.setattr(migrations, "_add_column", _record)
    monkeypatch.setattr(migrations, "SQLModel", SimpleNamespace(metadata=fake_meta))

    migrations.apply_missing_columns(
        engine,
        {
            "missing": {"id"},
            "sample": {"missing_col", "value"},
        },
    )

    assert calls == [("sample", "value")]


def test_apply_missing_columns_noop_for_empty(monkeypatch) -> None:
    calls: list[str] = []

    def _record(*_args, **_kwargs):
        calls.append("called")

    monkeypatch.setattr(migrations, "_add_column", _record)

    migrations.apply_missing_columns(_StubEngine(), {})

    assert calls == []


def test_add_column_warns_when_no_default(monkeypatch) -> None:
    metadata = MetaData()
    table = Table("sample", metadata, Column("id", Integer))
    column = Column("required", Integer, nullable=False)
    conn = _StubConnection()
    dialect = sqlite_dialect()

    monkeypatch.setattr(migrations, "_table_is_empty", lambda *_args, **_kwargs: False)

    migrations._add_column(conn, table, column, dialect.identifier_preparer, dialect)

    assert any("ADD COLUMN" in stmt for stmt in conn.statements) is True
    assert all("NOT NULL" not in stmt for stmt in conn.statements)


def test_add_column_drops_application_default(monkeypatch) -> None:
    metadata = MetaData()
    table = Table("sample", metadata, Column("id", Integer))
    column = Column("status", Integer, nullable=False, default=1)
    conn = _StubConnection()
    dialect = sqlite_dialect()

    monkeypatch.setattr(migrations, "_table_is_empty", lambda *_args, **_kwargs: False)

    migrations._add_column(conn, table, column, dialect.identifier_preparer, dialect)

    assert any("DEFAULT" in stmt for stmt in conn.statements)
    assert any("DROP DEFAULT" in stmt for stmt in conn.statements)


def test_resolve_default_sql_handles_server_default() -> None:
    column = Column("flag", Integer, server_default=text("1"))
    default_sql, drop_default = migrations._resolve_default_sql(
        column, sqlite_dialect(), allow_application_default=True
    )

    assert default_sql is not None
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


def test_foreign_key_name_truncates_long_identifiers() -> None:
    name = migrations._foreign_key_name("t" * 40, ("col" * 10,), "r" * 40)

    assert len(name) <= 63
    assert name.startswith("fk_")


def test_foreign_key_ddl_includes_ondelete_onupdate() -> None:
    metadata = MetaData()
    parent = Table("parent", metadata, Column("id", Integer, primary_key=True))
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
    conn = _StubConnection()

    class _HasRow:
        def first(self_inner):
            return (1,)

    class _Empty:
        def first(self_inner):
            return None

    def _execute_with_row(*_args, **_kwargs):
        return _HasRow()

    def _execute_empty(*_args, **_kwargs):
        return _Empty()

    conn.execute = _execute_empty  # type: ignore[assignment]
    assert migrations._table_is_empty(conn, sqlite_dialect().identifier_preparer, "table") is True

    conn.execute = _execute_with_row  # type: ignore[assignment]
    assert migrations._table_is_empty(conn, sqlite_dialect().identifier_preparer, "table") is False


def test_ensure_indexes_creates_missing(monkeypatch) -> None:
    metadata = MetaData()
    table = Table("items", metadata, Column("id", Integer), Column("name", Integer))
    idx_existing = Index("idx_existing", table.c.id)
    idx_conflict = Index("idx_conflict", table.c.name)
    idx_new = Index("idx_new", table.c.name)

    created: list[str] = []

    def _record_create(*_args, **_kwargs):
        created.append("created")

    idx_new.create = _record_create  # type: ignore[assignment]

    fake_meta = _fake_metadata({"items": table}, [table])

    class _Inspector:
        def get_table_names(self):
            return ["items"]

        def get_indexes(self, _table_name):
            return [
                {"name": "idx_existing", "column_names": ["id"], "unique": False},
                {"name": "idx_conflict", "column_names": ["id"], "unique": False},
            ]

    monkeypatch.setattr(migrations, "inspect", lambda _engine: _Inspector())
    monkeypatch.setattr(migrations, "SQLModel", SimpleNamespace(metadata=fake_meta))

    migrations.ensure_indexes(_StubEngine())

    assert created


def test_ensure_indexes_skips_missing_tables(monkeypatch) -> None:
    metadata = MetaData()
    table = Table("items", metadata, Column("id", Integer))
    Index("idx_items", table.c.id)
    fake_meta = _fake_metadata({"items": table}, [table])

    class _Inspector:
        def get_table_names(self):
            return []

        def get_indexes(self, _table_name):
            return []

    monkeypatch.setattr(migrations, "inspect", lambda _engine: _Inspector())
    monkeypatch.setattr(migrations, "SQLModel", SimpleNamespace(metadata=fake_meta))

    migrations.ensure_indexes(_StubEngine())


def test_ensure_foreign_keys_creates_missing_and_skips(monkeypatch) -> None:
    metadata = MetaData()
    parent = Table("parents", metadata, Column("id", Integer, primary_key=True))
    child = Table(
        "children",
        metadata,
        Column("parent_id", Integer),
        Column("alt_parent_id", Integer),
        ForeignKeyConstraint(["parent_id"], ["parents.id"], name="fk_existing"),
        ForeignKeyConstraint(["alt_parent_id"], ["parents.id"], name="fk_new"),
        ForeignKeyConstraint(["parent_id"], ["parents.id"], name="fk_missing"),
    )

    fake_meta = _fake_metadata({"parents": parent, "children": child}, [child])

    class _Inspector:
        def get_table_names(self):
            return ["children", "parents"]

        def get_foreign_keys(self, _table_name):
            return [
                {
                    "constrained_columns": ["parent_id"],
                    "referred_table": "parents",
                    "referred_columns": ["id"],
                }
            ]

    engine = _StubEngine()
    original_signature = migrations._constraint_signature

    def _stub_signature(constraint):
        signature = original_signature(constraint)
        if constraint.name == "fk_missing":
            return (signature[0], "", signature[2])
        return signature

    monkeypatch.setattr(migrations, "inspect", lambda _engine: _Inspector())
    monkeypatch.setattr(migrations, "SQLModel", SimpleNamespace(metadata=fake_meta))
    monkeypatch.setattr(migrations, "_constraint_signature", _stub_signature)

    migrations.ensure_foreign_keys(engine)

    statements = engine.connection.statements if engine.connection else []
    assert any("ALTER TABLE" in stmt for stmt in statements)


def test_ensure_foreign_keys_skips_missing_tables(monkeypatch) -> None:
    metadata = MetaData()
    parent = Table("parents", metadata, Column("id", Integer, primary_key=True))
    child = Table(
        "children",
        metadata,
        Column("parent_id", Integer),
        ForeignKeyConstraint(["parent_id"], ["parents.id"], name="fk_existing"),
    )
    fake_meta = _fake_metadata({"parents": parent, "children": child}, [child])

    class _Inspector:
        def get_table_names(self):
            return []

        def get_foreign_keys(self, _table_name):
            return []

    monkeypatch.setattr(migrations, "inspect", lambda _engine: _Inspector())
    monkeypatch.setattr(migrations, "SQLModel", SimpleNamespace(metadata=fake_meta))

    engine = _StubEngine()
    migrations.ensure_foreign_keys(engine)

    assert engine.connection is None or not engine.connection.statements
