"""Database schema validation helpers for Postgres."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel


class TableSchema(BaseModel):
    """Schema details for a single database table."""

    model_config = ConfigDict(extra="forbid")

    name: str
    columns: set[str] = Field(default_factory=set)


class DatabaseSchema(BaseModel):
    """Schema snapshot for a database connection."""

    model_config = ConfigDict(extra="forbid")

    tables: dict[str, TableSchema] = Field(default_factory=dict)

    def missing_tables(self, expected: DatabaseSchema) -> set[str]:
        """Return table names missing from the current schema."""
        return set(expected.tables) - set(self.tables)

    def missing_columns(self, expected: DatabaseSchema) -> dict[str, set[str]]:
        """Return missing columns for tables that exist in both schemas."""
        # pylint: disable=no-member
        missing: dict[str, set[str]] = {}
        for table_name, expected_table in expected.tables.items():
            actual_table = self.tables.get(table_name)
            if not actual_table:
                continue
            missing_columns = expected_table.columns - actual_table.columns
            if missing_columns:
                missing[table_name] = missing_columns
        return missing


class SchemaValidationResult(BaseModel):
    """Validation results for comparing expected and actual schemas."""

    model_config = ConfigDict(extra="forbid")

    missing_tables: set[str] = Field(default_factory=set)
    missing_columns: dict[str, set[str]] = Field(default_factory=dict)

    @property
    def is_valid(self) -> bool:
        """Return True when no schema issues were detected."""
        return not self.missing_tables and not self.missing_columns

    @classmethod
    def from_schemas(
        cls,
        expected: DatabaseSchema,
        actual: DatabaseSchema,
    ) -> SchemaValidationResult:
        """Build a validation result from expected and actual schemas."""
        return cls(
            missing_tables=actual.missing_tables(expected),
            missing_columns=actual.missing_columns(expected),
        )


def build_expected_schema() -> DatabaseSchema:
    """Build the expected schema from SQLModel metadata."""
    tables: dict[str, TableSchema] = {}
    for table_name, table in SQLModel.metadata.tables.items():
        columns = {column.name for column in table.columns}
        tables[table_name] = TableSchema(name=table_name, columns=columns)
    return DatabaseSchema(tables=tables)


def inspect_database_schema(engine: Engine) -> DatabaseSchema:
    """Inspect the live database schema for the configured engine."""
    inspector = inspect(engine)
    tables: dict[str, TableSchema] = {}
    for table_name in inspector.get_table_names():
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        tables[table_name] = TableSchema(name=table_name, columns=columns)
    return DatabaseSchema(tables=tables)
