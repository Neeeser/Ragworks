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
    assert config.features.umap_visualizations is True
    assert config.features.chat_branching is True


def test_catalog_covers_every_leaf_field_with_metadata() -> None:
    fields = iter_config_fields()
    keys = {field.key for field in fields}
    # One entry per leaf field of every section.
    expected_sections = {"auth", "uploads", "indexing", "features", "telemetry"}
    assert {key.split(".")[0] for key in keys} == expected_sections
    for field in fields:
        assert field.label, f"{field.key} missing label"
        assert field.description, f"{field.key} missing description"
        assert isinstance(field.kind, ConfigFieldKind)


def test_public_flags_are_marked() -> None:
    by_key = {field.key: field for field in iter_config_fields()}
    assert by_key["auth.allow_registration"].public is True
    assert by_key["features.umap_visualizations"].public is True
    # Backend policy fields are not public (admin + server concern only).
    assert by_key["telemetry.retention_days"].public is False


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


def test_constrained_fields_are_select_or_multi_select_kinds() -> None:
    """A field with a finite domain renders as select/multi_select, not free text.

    Regression for issue #76: `allowed_content_types` and `default_backend`
    used to be `string_list`/`string` with no options, so the admin UI
    rendered them as an unconstrained textarea/text input.
    """
    by_key = {field.key: field for field in iter_config_fields()}

    content_types_field = by_key["uploads.allowed_content_types"]
    assert content_types_field.kind == ConfigFieldKind.MULTI_SELECT
    assert content_types_field.options is not None
    assert {option.value for option in content_types_field.options} == {
        "application/pdf",
        "text/plain",
        "text/markdown",
        "text/csv",
    }

    backend_field = by_key["indexing.default_backend"]
    assert backend_field.kind == ConfigFieldKind.SELECT
    assert backend_field.options is not None
    assert {option.value for option in backend_field.options} == {"pgvector", "pinecone"}


def test_bounded_int_fields_expose_their_ge_le_as_catalog_bounds() -> None:
    by_key = {field.key: field for field in iter_config_fields()}
    upload_size = by_key["uploads.max_upload_size_mb"]
    assert (upload_size.min_value, upload_size.max_value) == (1, 1024)
    retention = by_key["telemetry.retention_days"]
    assert (retention.min_value, retention.max_value) == (1, 3650)


def test_unconstrained_fields_have_no_options_or_bounds() -> None:
    by_key = {field.key: field for field in iter_config_fields()}
    assert by_key["auth.allow_registration"].options is None
    assert by_key["auth.allow_registration"].min_value is None


def test_allowed_content_types_rejects_unknown_mime_types() -> None:
    """A crafted PATCH must not persist a MIME type no shipped parser
    understands, even though the field is a plain `list[str]` at the storage
    layer (issue #76)."""
    with pytest.raises(ValidationError):
        AppConfig.model_validate(
            {"uploads": {"allowed_content_types": ["application/x-not-a-real-type"]}}
        )


def test_default_backend_rejects_unregistered_backend_values() -> None:
    with pytest.raises(ValidationError):
        AppConfig.model_validate({"indexing": {"default_backend": "not-a-backend"}})
