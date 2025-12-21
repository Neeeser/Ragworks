from __future__ import annotations

from sqlmodel import SQLModel

from app.db import models  # noqa: F401
from app.db.schema import SchemaValidationResult, build_expected_schema, inspect_database_schema
from tests.utils.db import create_test_engine


def test_schema_validation_detects_missing_tables() -> None:
    engine = create_test_engine()
    SQLModel.metadata.drop_all(engine)

    expected = build_expected_schema()
    actual = inspect_database_schema(engine)
    result = SchemaValidationResult.from_schemas(expected, actual)

    assert result.missing_tables == set(expected.tables.keys())


def test_schema_validation_passes_after_create_all() -> None:
    engine = create_test_engine()
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)

    expected = build_expected_schema()
    actual = inspect_database_schema(engine)
    result = SchemaValidationResult.from_schemas(expected, actual)

    assert result.is_valid
