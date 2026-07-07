"""Behavior tests for the AppConfig schema and its field catalog."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.app_config import (
    AppConfig,
    ConfigFieldKind,
    iter_config_fields,
)


def test_defaults_construct_a_complete_config() -> None:
    config = AppConfig()
    assert config.auth.allow_registration is True
    assert config.uploads.max_upload_size_mb == 50
    assert config.models.default_chat_model
    assert config.features.umap_visualizations is True
    assert config.features.chat_branching is True


def test_catalog_covers_every_leaf_field_with_metadata() -> None:
    fields = iter_config_fields()
    keys = {field.key for field in fields}
    # One entry per leaf field of every section.
    expected_sections = {"auth", "uploads", "models", "features"}
    assert {key.split(".")[0] for key in keys} == expected_sections
    for field in fields:
        assert field.label, f"{field.key} missing label"
        assert field.description, f"{field.key} missing description"
        assert isinstance(field.kind, ConfigFieldKind)


def test_model_defaults_are_env_pinnable_and_public_flags_are_marked() -> None:
    by_key = {field.key: field for field in iter_config_fields()}
    assert by_key["models.default_chat_model"].env_var == "OPENROUTER_DEFAULT_CHAT_MODEL"
    assert by_key["auth.allow_registration"].public is True
    assert by_key["features.umap_visualizations"].public is True
    # Model defaults are not public (admin + server concern only).
    assert by_key["models.default_chat_model"].public is False


def test_invalid_override_shapes_are_rejected() -> None:
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"uploads": {"max_upload_size_mb": "not-a-number"}})
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"uploads": {"max_upload_size_mb": 0}})  # ge=1 bound
