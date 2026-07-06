"""Schema migration helpers for SQLModel-backed Postgres databases."""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import Any

from sqlalchemy import inspect, literal, text
from sqlalchemy.engine import Connection, Dialect, Engine
from sqlalchemy.sql.compiler import IdentifierPreparer
from sqlalchemy.sql.schema import (
    Column,
    ColumnDefault,
    DefaultClause,
    ForeignKeyConstraint,
    Table,
)
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

_MAX_IDENTIFIER_LENGTH = 63
_IndexSignature = tuple[tuple[str, ...], bool]
_ForeignKeySignature = tuple[tuple[str, ...], str, tuple[str, ...]]


def apply_missing_columns(engine: Engine, missing_columns: Mapping[str, set[str]]) -> None:
    """Add missing columns to existing tables using SQLModel metadata."""
    if not missing_columns:
        return

    preparer = engine.dialect.identifier_preparer
    with engine.begin() as connection:
        for table_name in sorted(missing_columns):
            columns = missing_columns[table_name]
            table = SQLModel.metadata.tables.get(table_name)
            if table is None:
                logger.warning("Missing metadata for table %s; skipping migration.", table_name)
                continue
            for column_name in sorted(columns):
                column = table.columns.get(column_name)
                if column is None:
                    logger.warning(
                        "Missing metadata for column %s.%s; skipping migration.",
                        table_name,
                        column_name,
                    )
                    continue
                _add_column(connection, table, column, preparer, engine.dialect)


def ensure_indexes(engine: Engine) -> None:
    """Ensure metadata-defined indexes exist in the database."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    for table in SQLModel.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue
        existing_indexes = inspector.get_indexes(table.name)
        existing_signatures = {
            _index_signature(
                [name for name in index["column_names"] if name is not None],
                index.get("unique", False),
            )
            for index in existing_indexes
        }
        existing_names = {index["name"] for index in existing_indexes if index.get("name")}

        for index in table.indexes:
            signature = _index_signature([column.name for column in index.columns], index.unique)
            if signature in existing_signatures:
                continue
            if index.name and index.name in existing_names:
                logger.warning(
                    "Index name %s already exists on %s; skipping.",
                    index.name,
                    table.name,
                )
                continue
            index.create(bind=engine, checkfirst=True)
            logger.info("Created index %s on %s.", index.name, table.name)


def ensure_foreign_keys(engine: Engine) -> None:
    """Ensure metadata-defined foreign keys exist in the database."""
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    preparer = engine.dialect.identifier_preparer

    with engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            existing_fks = inspector.get_foreign_keys(table.name)
            existing_signatures = {
                _foreign_key_signature(
                    tuple(fk["constrained_columns"]),
                    fk["referred_table"],
                    tuple(fk["referred_columns"]),
                )
                for fk in existing_fks
            }
            for constraint in table.foreign_key_constraints:
                signature = _constraint_signature(constraint)
                if not signature[1]:
                    logger.warning(
                        "Foreign key on %s has no referred table; skipping.", table.name
                    )
                    continue
                if signature in existing_signatures:
                    continue
                name = (
                    constraint.name
                    if isinstance(constraint.name, str)
                    else _foreign_key_name(table.name, signature[0], signature[1])
                )
                ddl = _foreign_key_ddl(preparer, table.name, name, signature, constraint)
                connection.execute(text(ddl))
                logger.info("Created foreign key %s on %s.", name, table.name)


def _add_column(
    connection: Connection,
    table: Table,
    column: Column[Any],
    preparer: IdentifierPreparer,
    dialect: Dialect,
) -> None:
    """Add a column to an existing table with safe defaults."""
    table_is_empty = _table_is_empty(connection, preparer, table.name)
    requires_default = not column.nullable and not table_is_empty
    default_sql, drop_default = _resolve_default_sql(
        column, dialect, allow_application_default=requires_default
    )
    column_type = column.type.compile(dialect=dialect)

    column_parts = [preparer.quote(column.name), column_type]
    if default_sql:
        column_parts.append(f"DEFAULT {default_sql}")

    if not column.nullable:
        if requires_default and default_sql is None:
            logger.warning(
                "Column %s.%s is non-nullable with no default; adding as nullable.",
                table.name,
                column.name,
            )
        else:
            column_parts.append("NOT NULL")

    ddl = (
        f"ALTER TABLE {preparer.quote(table.name)} "
        f"ADD COLUMN IF NOT EXISTS {' '.join(column_parts)}"
    )
    connection.execute(text(ddl))

    if drop_default:
        drop_ddl = (
            f"ALTER TABLE {preparer.quote(table.name)} "
            f"ALTER COLUMN {preparer.quote(column.name)} DROP DEFAULT"
        )
        connection.execute(text(drop_ddl))


def _table_is_empty(
    connection: Connection, preparer: IdentifierPreparer, table_name: str
) -> bool:
    """Return True when the target table has no rows."""
    result = connection.execute(
        text(f"SELECT 1 FROM {preparer.quote(table_name)} LIMIT 1")
    ).first()
    return result is None


def _resolve_default_sql(
    column: Column[Any],
    dialect: Dialect,
    *,
    allow_application_default: bool,
) -> tuple[str | None, bool]:
    """Return SQL for the column default and whether to drop it after backfill."""
    server_default = column.server_default
    if isinstance(server_default, DefaultClause) and server_default.arg is not None:
        default_expr = server_default.arg
        default_sql = (
            default_expr
            if isinstance(default_expr, str)
            else str(
                default_expr.compile(dialect=dialect, compile_kwargs={"literal_binds": True})
            )
        )
        return default_sql, False

    default = column.default
    if allow_application_default and isinstance(default, ColumnDefault) and default.is_scalar:
        default_value = default.arg
        if isinstance(default_value, Enum):
            default_value = default_value.value
        default_sql = str(
            literal(default_value, type_=column.type).compile(
                dialect=dialect, compile_kwargs={"literal_binds": True}
            )
        )
        return default_sql, column.server_default is None

    return None, False


def _index_signature(columns: Sequence[str], unique: bool) -> _IndexSignature:
    """Build a comparable signature for an index."""
    return (tuple(columns), bool(unique))


def _constraint_signature(constraint: ForeignKeyConstraint) -> _ForeignKeySignature:
    """Build a comparable signature for a foreign key constraint."""
    local_columns = tuple(column.name for column in constraint.columns)
    referred_table = (
        constraint.referred_table.name if constraint.referred_table is not None else ""
    )
    referred_columns = tuple(element.column.name for element in constraint.elements)
    return (local_columns, referred_table, referred_columns)


def _foreign_key_signature(
    local_columns: tuple[str, ...],
    referred_table: str | None,
    referred_columns: tuple[str, ...],
) -> _ForeignKeySignature:
    """Build a comparable signature for a foreign key inspector entry."""
    return (local_columns, referred_table or "", referred_columns)


def _foreign_key_name(
    table_name: str, local_columns: tuple[str, ...], referred_table: str
) -> str:
    """Generate a stable foreign key name within Postgres limits."""
    base = f"fk_{table_name}_{'_'.join(local_columns)}_{referred_table}"
    if len(base) <= _MAX_IDENTIFIER_LENGTH:
        return base
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:8]
    truncated = base[: _MAX_IDENTIFIER_LENGTH - 9]
    return f"{truncated}_{digest}"


def _foreign_key_ddl(
    preparer: IdentifierPreparer,
    table_name: str,
    name: str,
    signature: _ForeignKeySignature,
    constraint: ForeignKeyConstraint,
) -> str:
    """Build an ALTER TABLE statement for a foreign key constraint."""
    local_columns, referred_table, referred_columns = signature
    local_sql = ", ".join(preparer.quote(column) for column in local_columns)
    referred_sql = ", ".join(preparer.quote(column) for column in referred_columns)

    ddl = (
        f"ALTER TABLE {preparer.quote(table_name)} "
        f"ADD CONSTRAINT {preparer.quote(name)} "
        f"FOREIGN KEY ({local_sql}) "
        f"REFERENCES {preparer.quote(referred_table)} ({referred_sql})"
    )

    ondelete = _constraint_ondelete(constraint)
    if ondelete:
        ddl += f" ON DELETE {ondelete}"
    onupdate = _constraint_onupdate(constraint)
    if onupdate:
        ddl += f" ON UPDATE {onupdate}"
    return ddl


def _constraint_ondelete(constraint: ForeignKeyConstraint) -> str | None:
    """Return the ondelete action for a foreign key constraint."""
    elements = list(constraint.elements)
    if not elements:
        return None
    return elements[0].ondelete


def _constraint_onupdate(constraint: ForeignKeyConstraint) -> str | None:
    """Return the onupdate action for a foreign key constraint."""
    elements = list(constraint.elements)
    if not elements:
        return None
    return elements[0].onupdate
