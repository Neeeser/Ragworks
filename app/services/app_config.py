"""Runtime application config: resolution, catalog, and sparse PATCH.

Precedence for every field is env-pin -> DB override -> code default
(`AppConfigService.effective_config`). The DB is Layer 2 of the config
architecture (see root AGENTS.md): code defaults ship in
`app.schemas.app_config.AppConfig`, admin-editable overrides live in the
sparse `app_settings` table, and a field named in an override's
``env_var`` metadata is pinned read-only whenever that variable is set in
the process environment.

`get_app_config()` is the module-level, call-time read for every call site
that isn't already holding a request-scoped session (routes construct
`AppConfigService(session)` directly; pipeline node config `default_factory`
callables and other non-request code call `get_app_config()`). Like
`get_settings()`, it must never be snapshotted at import time -- call it at
the point of use. Unlike `get_settings()`, its source of truth is the
database, which is slower and can be briefly unavailable (e.g. during
startup before migrations run), so reads are cached for `_CACHE_TTL_SECONDS`
behind a lock, and a DB failure degrades to the env+defaults config with a
logged warning rather than raising -- a config read must never be able to
take the app down.

Opening a session directly via `session_scope()` on a cache miss is a
deliberate, documented exception to "sessions have one owner" (app/AGENTS.md):
`get_app_config()` has no request to borrow a session from, exactly like
`app/db/engine.py`'s own module-level engine construction and `get_settings()`
having no request context either -- it is a bootstrap/infrastructure-level
read, not application request handling.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlmodel import Session

from app.core.config import get_settings
from app.db.engine import session_scope
from app.db.repositories import AppSettingRepository
from app.schemas.admin import ConfigFieldRead, ConfigSource
from app.schemas.app_config import AppConfig, ConfigFieldMeta, iter_config_fields
from app.services.errors import InvalidInputError

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 30.0

# Explicit map from a field's dotted config key to the `Settings` attribute
# that supplies its pinned value when the field's `env_var` is set. Kept as
# a literal dict (not reflection) so adding an env-pinned field is a
# one-line, greppable change in both `app_config.py` and here.
_ENV_PINNED_SETTINGS_ATTR: dict[str, str] = {
    "models.default_chat_model": "default_chat_model",
    "models.default_embedding_model": "default_embedding_model",
}

_cache_lock = threading.Lock()
_cache: tuple[float, AppConfig] | None = None


def invalidate_app_config_cache() -> None:
    """Clear the process-wide cache (called after a PATCH, and by tests)."""
    global _cache  # pylint: disable=global-statement
    with _cache_lock:
        _cache = None


def get_app_config() -> AppConfig:
    """Return the effective config, reading the DB at most once per TTL.

    Degrades to the env+defaults config (no DB read) if the database is
    unreachable, logging a warning rather than raising -- see module
    docstring for why this call can never be allowed to fail the caller.
    """
    global _cache  # pylint: disable=global-statement
    with _cache_lock:
        if _cache is not None:
            cached_at, cached_config = _cache
            if time.monotonic() - cached_at < _CACHE_TTL_SECONDS:
                return cached_config
        try:
            with session_scope() as session:
                config = AppConfigService(session).effective_config()
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Failed to read runtime config from the database; "
                "falling back to env+defaults.",
                exc_info=True,
            )
            config = _env_and_defaults_config()
        _cache = (time.monotonic(), config)
        return config


def _env_and_defaults_config() -> AppConfig:
    """Build a config from code defaults with only env pins applied."""
    data = AppConfig().model_dump()
    for field in iter_config_fields():
        if field.env_var and field.env_var in os.environ:
            _set_leaf(data, field.key, _env_pinned_value(field))
    return AppConfig.model_validate(data)


def _env_pinned_value(field: ConfigFieldMeta) -> Any:
    """Return the pinned value for an env-pinned field, read from Settings."""
    return getattr(get_settings(), _ENV_PINNED_SETTINGS_ATTR[field.key])


def _is_env_pinned(field: ConfigFieldMeta) -> bool:
    return bool(field.env_var) and field.env_var in os.environ


def _set_leaf(data: dict[str, Any], dotted_key: str, value: Any) -> None:
    section, leaf = dotted_key.split(".", 1)
    data[section][leaf] = value


class AppConfigService:
    """Resolve, catalog, and update the runtime application config."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.settings = AppSettingRepository(session)

    def effective_config(self) -> AppConfig:
        """Merge code defaults <- DB overrides <- env pins into an AppConfig."""
        data = AppConfig().model_dump()
        overrides = self.settings.all_overrides()
        known = {field.key for field in iter_config_fields()}
        for key, value in overrides.items():
            if key not in known:
                logger.warning("Ignoring unknown config override %r", key)
                continue
            _set_leaf(data, key, value)
        for field in iter_config_fields():
            if _is_env_pinned(field):
                _set_leaf(data, field.key, _env_pinned_value(field))
        try:
            return AppConfig.model_validate(data)
        except ValidationError as exc:
            logger.warning(
                "Invalid config overrides in DB; falling back field-by-field: %s", exc
            )
            return self._validate_dropping_bad_overrides(data, overrides)

    def _validate_dropping_bad_overrides(
        self, data: dict[str, Any], overrides: dict[str, Any]
    ) -> AppConfig:
        """Retry validation, dropping each override that fails, one at a time.

        A malformed row (wrong type, out of range) must never poison the
        whole config -- each bad leaf is reset to its code default and
        logged, so every other override still applies.
        """
        defaults = AppConfig().model_dump()
        while True:
            try:
                return AppConfig.model_validate(data)
            except ValidationError as exc:
                dropped_any = False
                for error in exc.errors():
                    dotted_key = ".".join(str(part) for part in error["loc"])
                    if dotted_key in overrides:
                        logger.warning(
                            "Dropping invalid config override %r: %s",
                            dotted_key,
                            error["msg"],
                        )
                        section, leaf = dotted_key.split(".", 1)
                        data[section][leaf] = defaults[section][leaf]
                        dropped_any = True
                if not dropped_any:
                    # Nothing left we recognize as a dropped override; a
                    # bug elsewhere produced invalid defaults/env pins.
                    raise

    def field_catalog(self) -> list[ConfigFieldRead]:
        """Return every field's metadata alongside its resolved value/source."""
        overrides = self.settings.all_overrides()
        effective = self.effective_config()
        entries: list[ConfigFieldRead] = []
        for field in iter_config_fields():
            section, leaf = field.key.split(".", 1)
            value = getattr(getattr(effective, section), leaf)
            default = getattr(getattr(AppConfig(), section), leaf)
            if _is_env_pinned(field):
                source = ConfigSource.ENV
            elif field.key in overrides:
                source = ConfigSource.OVERRIDE
            else:
                source = ConfigSource.DEFAULT
            entries.append(
                ConfigFieldRead(
                    key=field.key,
                    label=field.label,
                    description=field.description,
                    kind=field.kind,
                    public=field.public,
                    env_var=field.env_var,
                    value=value,
                    default=default,
                    source=source,
                )
            )
        return entries

    def apply_update(
        self, patch: dict[str, dict[str, Any]], updated_by: UUID
    ) -> AppConfig:
        """Apply a sparse nested patch; a `null` leaf resets to default.

        Raises `InvalidInputError` (per-field `{dotted_key: message}` detail)
        for unknown keys, env-pinned keys, or values the model rejects.
        Writes/deletes override rows only for the patched keys, commits, and
        invalidates the process cache.
        """
        patched_keys = _validate_patch_keys(patch)

        defaults = AppConfig().model_dump()
        data = self.effective_config().model_dump()
        for section, leaf, value in patched_keys:
            # A `null` leaf means "reset to default", not "set the leaf to
            # None" -- every leaf type here (bool/int/str/string_list) is
            # non-optional, so validating `None` against the model would
            # always fail. Substitute the code default before validating.
            data[section][leaf] = defaults[section][leaf] if value is None else value

        try:
            new_config = AppConfig.model_validate(data)
        except ValidationError as exc:
            errors = {
                ".".join(str(part) for part in error["loc"]): error["msg"]
                for error in exc.errors()
            }
            raise InvalidInputError(errors) from exc

        for section, leaf, value in patched_keys:
            dotted_key = f"{section}.{leaf}"
            if value is None:
                self.settings.delete(dotted_key)
            else:
                self.settings.upsert(dotted_key, value, updated_by=updated_by)
        self.session.commit()
        invalidate_app_config_cache()
        return new_config


def _validate_patch_keys(patch: dict[str, dict[str, Any]]) -> list[tuple[str, str, Any]]:
    """Validate patch keys against the catalog; return the accepted leaves.

    Raises `InvalidInputError` (per-field detail) for a non-object section,
    an unknown key, or an env-pinned key -- collecting every such problem
    before raising, so a caller sees all rejected fields in one response.
    """
    known = {field.key for field in iter_config_fields()}
    env_pinned = {field.key for field in iter_config_fields() if _is_env_pinned(field)}
    errors: dict[str, str] = {}
    patched_keys: list[tuple[str, str, Any]] = []

    for section, leaves in patch.items():
        if not isinstance(leaves, dict):
            errors[section] = "Expected an object of leaf values."
            continue
        for leaf, value in leaves.items():
            dotted_key = f"{section}.{leaf}"
            if dotted_key not in known:
                errors[dotted_key] = "Unknown config field."
            elif dotted_key in env_pinned:
                errors[dotted_key] = "Field is pinned by an environment variable."
            else:
                patched_keys.append((section, leaf, value))

    if errors:
        raise InvalidInputError(errors)
    return patched_keys
