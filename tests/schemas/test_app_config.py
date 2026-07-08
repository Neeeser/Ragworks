"""Behavior tests for the AppConfig schema and its field catalog."""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from app.schemas.app_config import (
    PUBLIC_CONFIG_KEYS,
    AppConfig,
    ConfigFieldKind,
    PublicConfig,
    iter_config_fields,
)
from app.services.app_config import _ENV_PINNED_SETTINGS_ATTR


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


def test_public_wire_model_covers_exactly_the_public_marked_fields() -> None:
    """A field marked public=True must appear on PublicConfig, and vice versa.

    PublicConfig is built explicitly (so it can never *leak* a non-public
    field), but nothing else stops a new public=True field from silently
    never being served -- this guard fails the moment the catalog's public
    markings and the wire model drift in either direction.
    """
    wire_keys: set[str] = set()
    for section_name, section_field in PublicConfig.model_fields.items():
        section_model = section_field.annotation
        assert section_model is not None
        assert issubclass(section_model, BaseModel)
        wire_keys.update(f"{section_name}.{leaf}" for leaf in section_model.model_fields)
    assert wire_keys == set(PUBLIC_CONFIG_KEYS)


def test_every_env_pinnable_field_has_a_settings_attribute_mapping() -> None:
    """An env_var-carrying field missing from _ENV_PINNED_SETTINGS_ATTR would
    KeyError inside config resolution the moment that variable is set --
    including in the never-fails fallback path -- so pin the pairing here.
    """
    env_pinnable = {field.key for field in iter_config_fields() if field.env_var}
    assert env_pinnable == set(_ENV_PINNED_SETTINGS_ATTR)


def test_invalid_override_shapes_are_rejected() -> None:
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"uploads": {"max_upload_size_mb": "not-a-number"}})
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"uploads": {"max_upload_size_mb": 0}})  # ge=1 bound
