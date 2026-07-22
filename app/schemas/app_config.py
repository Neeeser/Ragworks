"""The runtime application config schema — the single source of truth.

Every runtime-editable setting is a field on one of the section models below.
Code defaults live here; the DB stores sparse overrides; env vars named in
``env_var`` metadata pin a field read-only. The admin UI renders its settings
forms from ``iter_config_fields()`` — adding a setting here (with metadata and
an enforcement site) is the whole recipe; see app/AGENTS.md.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import StrEnum
from typing import Any

import annotated_types
from pydantic import BaseModel, Field, field_validator
from pydantic.fields import FieldInfo

from app.schemas.content_types import DEFAULT_ALLOWED_CONTENT_TYPES, KNOWN_CONTENT_TYPE_VALUES
from app.schemas.content_types import KNOWN_CONTENT_TYPES as KNOWN_CONTENT_TYPE_OPTIONS
from app.schemas.enums import IndexBackend

# Code defaults for the model fields mirror app/core/config.py's Settings
# defaults so an un-overridden install behaves identically either way.
# Deliberately empty: OpenRouter's embedding catalog shifts over time, so a
# hardcoded model id rots (we shipped one that 502'd every first upload).
# The first-run setup wizard seeds this with the user's confirmed choice.


def _meta(
    label: str,
    description: str,
    *,
    public: bool = False,
    env_var: str | None = None,
    options: Sequence[tuple[str, str]] | None = None,
) -> dict[str, Any]:
    """Build the json_schema_extra payload every config field carries.

    `options` declares a field's finite valid-value domain as `(value, label)`
    pairs — its presence is what turns a `str`/`list[str]` field into a
    `select`/`multi_select` control (see `iter_config_fields`) instead of free
    text. Numeric bounds need no equivalent here: they're read straight off
    the field's own `ge`/`le` constraints, so there's one place to keep them
    in sync.
    """
    return {
        "label": label,
        "description": description,
        "public": public,
        "env_var": env_var,
        "options": list(options) if options is not None else None,
    }


class AuthSettings(BaseModel):
    """Account/registration policy."""

    allow_registration: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Allow sign-ups",
            "When off, new account registration is disabled and the sign-up "
            "page is hidden; existing users are unaffected.",
            public=True,
        ),
    )


class UploadSettings(BaseModel):
    """Upload limits and ingestion eligibility.

    Any file type may be uploaded to a collection's file tree (subject to the
    size cap); `allowed_content_types` decides which types are *auto-ingested*
    by the collection's pipeline, not which uploads are accepted.
    """

    max_upload_size_mb: int = Field(
        default=50,
        ge=1,
        le=1024,
        json_schema_extra=_meta(
            "Max upload size (MB)",
            "Uploads larger than this are rejected.",
            public=True,
        ),
    )
    ingestion_concurrency: int = Field(
        default=4,
        ge=1,
        le=16,
        json_schema_extra=_meta(
            "Ingestion concurrency",
            "How many documents are ingested at once; further uploads queue "
            "as pending until a worker is free. Raise it when the embedding "
            "provider is fast and local (e.g. Ollama on the same machine). "
            "Applies on the next backend restart.",
        ),
    )
    allowed_content_types: list[str] = Field(
        default_factory=lambda: list(DEFAULT_ALLOWED_CONTENT_TYPES),
        json_schema_extra=_meta(
            "Auto-ingested content types",
            "Uploads whose MIME type is in this list are automatically run "
            "through the collection's ingestion pipeline; other types are "
            "stored without indexing (and can be ingested manually). Limited "
            "to MIME types a shipped parser actually handles.",
            public=True,
            options=[(option.value, option.label) for option in KNOWN_CONTENT_TYPE_OPTIONS],
        ),
    )

    @field_validator("allowed_content_types")
    @classmethod
    def _known_content_types(cls, value: list[str]) -> list[str]:
        """Restrict the field to MIME types a shipped parser handles."""
        unknown = sorted({item for item in value if item not in KNOWN_CONTENT_TYPE_VALUES})
        if unknown:
            raise ValueError(f"unsupported content type(s): {', '.join(unknown)}")
        return value


class IndexingSettings(BaseModel):
    """Vector-index backend policy for newly scaffolded pipelines."""

    default_backend: str = Field(
        default=IndexBackend.PGVECTOR.value,
        json_schema_extra=_meta(
            "Default index backend",
            "Vector store new default pipelines index into: 'pgvector' "
            "(built into the shipped Postgres, no account needed) or "
            "'pinecone' (requires a per-user API key). Existing pipelines "
            "are unaffected.",
            public=True,
            options=[
                (IndexBackend.PGVECTOR.value, "pgvector"),
                (IndexBackend.PINECONE.value, "Pinecone"),
            ],
        ),
    )

    @field_validator("default_backend")
    @classmethod
    def _known_backend(cls, value: str) -> str:
        """Restrict the field to registered `IndexBackend` values."""
        allowed = {backend.value for backend in IndexBackend}
        if value not in allowed:
            raise ValueError(f"must be one of: {', '.join(sorted(allowed))}")
        return value


class FeatureFlags(BaseModel):
    """Feature toggles served to the frontend and enforced at their routes."""

    umap_visualizations: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "UMAP visualizations",
            "Embedding-projection visualizations for collections.",
            public=True,
        ),
    )
    chat_branching: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Chat branching",
            "Branching a chat session from an earlier message.",
            public=True,
        ),
    )


class TelemetrySettings(BaseModel):
    """Internal activity recording — nothing ever leaves the deployment."""

    enabled: bool = Field(
        default=True,
        json_schema_extra=_meta(
            "Telemetry",
            "Record activity events (chat usage, ingestions, sign-ins) to the "
            "local database for the admin dashboards. Never sent externally.",
        ),
    )
    retention_days: int = Field(
        default=90,
        ge=1,
        le=3650,
        json_schema_extra=_meta(
            "Telemetry retention (days)",
            "Events older than this are purged on startup.",
        ),
    )


class AppConfig(BaseModel):
    """Root runtime config: one field per section model."""

    auth: AuthSettings = Field(default_factory=AuthSettings)
    uploads: UploadSettings = Field(default_factory=UploadSettings)
    indexing: IndexingSettings = Field(default_factory=IndexingSettings)
    features: FeatureFlags = Field(default_factory=FeatureFlags)
    telemetry: TelemetrySettings = Field(default_factory=TelemetrySettings)


class ConfigFieldKind(StrEnum):
    """Input widget kinds the admin settings renderer understands.

    A field's kind is inferred from its storage type (`_KIND_BY_ANNOTATION`)
    *unless* it declares `options` in its metadata, in which case a `str`
    becomes `SELECT` and a `list[str]` becomes `MULTI_SELECT` — the storage
    type stays the wire shape, `options` is what says the domain is finite.
    """

    BOOL = "bool"
    INT = "int"
    STRING = "string"
    STRING_LIST = "string_list"
    SELECT = "select"
    MULTI_SELECT = "multi_select"


class ConfigFieldOption(BaseModel):
    """One selectable value for a `select`/`multi_select` config field."""

    value: str
    label: str


class ConfigFieldMeta(BaseModel):
    """Catalog entry describing one leaf config field."""

    key: str
    label: str
    description: str
    kind: ConfigFieldKind
    public: bool
    env_var: str | None
    options: list[ConfigFieldOption] | None = None
    min_value: int | None = None
    max_value: int | None = None


_KIND_BY_ANNOTATION: dict[Any, ConfigFieldKind] = {
    bool: ConfigFieldKind.BOOL,
    int: ConfigFieldKind.INT,
    str: ConfigFieldKind.STRING,
    list[str]: ConfigFieldKind.STRING_LIST,
}

_SELECT_KIND_BY_STORAGE_KIND: dict[ConfigFieldKind, ConfigFieldKind] = {
    ConfigFieldKind.STRING: ConfigFieldKind.SELECT,
    ConfigFieldKind.STRING_LIST: ConfigFieldKind.MULTI_SELECT,
}


def _numeric_bounds(leaf: FieldInfo) -> tuple[int | None, int | None]:
    """Read a field's `ge`/`le` constraints off its own Pydantic metadata.

    Bounds live nowhere else so the admin catalog can never disagree with
    the validation `AppConfig.model_validate` already enforces on PATCH.
    """
    min_value: int | None = None
    max_value: int | None = None
    for constraint in leaf.metadata:
        if isinstance(constraint, annotated_types.Ge) and isinstance(constraint.ge, int):
            min_value = constraint.ge
        elif isinstance(constraint, annotated_types.Le) and isinstance(constraint.le, int):
            max_value = constraint.le
    return min_value, max_value


def _parse_options(raw: object) -> list[ConfigFieldOption] | None:
    """Narrow a metadata `options` entry (loosely typed by pydantic's own
    `json_schema_extra` stubs) into `ConfigFieldOption`s."""
    if not isinstance(raw, list):
        return None
    return [
        ConfigFieldOption(value=str(pair[0]), label=str(pair[1]))
        for pair in raw
        if isinstance(pair, list | tuple) and len(pair) == 2
    ]


def _section_models() -> list[tuple[str, type[BaseModel]]]:
    """Return each root section's (name, model class), type-narrowed.

    ``AppConfig.model_fields`` values are ``FieldInfo`` objects whose
    ``annotation`` is typed ``type[Any] | None`` — genuinely open, since
    pydantic doesn't know our fields are all ``BaseModel`` subclasses. This
    narrows that once, at the one call site that needs it.
    """
    sections: list[tuple[str, type[BaseModel]]] = []
    for section_name, section_field in AppConfig.model_fields.items():
        section_model = section_field.annotation
        if not isinstance(section_model, type) or not issubclass(section_model, BaseModel):
            raise TypeError(f"AppConfig.{section_name} is not a BaseModel section")
        sections.append((section_name, section_model))
    return sections


def iter_config_fields() -> list[ConfigFieldMeta]:
    """Return catalog metadata for every leaf field, in declaration order."""
    entries: list[ConfigFieldMeta] = []
    for section_name, section_model in _section_models():
        for leaf_name, leaf in section_model.model_fields.items():
            extra = leaf.json_schema_extra
            if not isinstance(extra, dict):
                raise TypeError(f"{section_name}.{leaf_name} missing _meta")
            kind = _KIND_BY_ANNOTATION[leaf.annotation]
            options = _parse_options(extra.get("options"))
            if options is not None:
                kind = _SELECT_KIND_BY_STORAGE_KIND[kind]
            min_value, max_value = (
                _numeric_bounds(leaf) if kind == ConfigFieldKind.INT else (None, None)
            )
            env_var = extra["env_var"]
            entries.append(
                ConfigFieldMeta(
                    key=f"{section_name}.{leaf_name}",
                    label=str(extra["label"]),
                    description=str(extra["description"]),
                    kind=kind,
                    public=bool(extra["public"]),
                    env_var=env_var if isinstance(env_var, str) else None,
                    options=options,
                    min_value=min_value,
                    max_value=max_value,
                )
            )
    return entries


PUBLIC_CONFIG_KEYS: frozenset[str] = frozenset(
    field.key for field in iter_config_fields() if field.public
)


class PublicAuthConfig(BaseModel):
    """Public auth section: registration policy the frontend needs to know."""

    allow_registration: bool


class PublicUploadConfig(BaseModel):
    """Public upload section: limits the frontend enforces client-side."""

    max_upload_size_mb: int
    allowed_content_types: list[str]


class PublicIndexingConfig(BaseModel):
    """Public indexing section: the wizard preselects the default backend."""

    default_backend: str


class PublicFeatureFlags(BaseModel):
    """Public feature flags the frontend gates UI on."""

    umap_visualizations: bool
    chat_branching: bool


class PublicConfig(BaseModel):
    """The subset of `AppConfig` served unauthenticated at `GET /api/config`.

    Deliberately its own model, built explicitly from an `AppConfig` (never a
    reflective subset) -- a new public field means touching this model on
    purpose, so `GET /api/config` can never leak a field (like `models`,
    which carries no `public=True` leaves) by accident.
    """

    auth: PublicAuthConfig
    uploads: PublicUploadConfig
    indexing: PublicIndexingConfig
    features: PublicFeatureFlags

    @classmethod
    def from_app_config(cls, config: AppConfig) -> PublicConfig:
        """Build the public wire shape from the full effective config."""
        return cls(
            auth=PublicAuthConfig(allow_registration=config.auth.allow_registration),
            uploads=PublicUploadConfig(
                max_upload_size_mb=config.uploads.max_upload_size_mb,
                allowed_content_types=config.uploads.allowed_content_types,
            ),
            indexing=PublicIndexingConfig(
                default_backend=config.indexing.default_backend,
            ),
            features=PublicFeatureFlags(
                umap_visualizations=config.features.umap_visualizations,
                chat_branching=config.features.chat_branching,
            ),
        )
