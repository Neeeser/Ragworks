"""The runtime application config schema — the single source of truth.

Every runtime-editable setting is a field on one of the section models below.
Code defaults live here; the DB stores sparse overrides; env vars named in
``env_var`` metadata pin a field read-only. The admin UI renders its settings
forms from ``iter_config_fields()`` — adding a setting here (with metadata and
an enforcement site) is the whole recipe; see app/AGENTS.md.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

# Code defaults for the model fields mirror app/core/config.py's Settings
# defaults so an un-overridden install behaves identically either way.
_DEFAULT_CHAT_MODEL = "openai/gpt-oss-120b"
_DEFAULT_EMBEDDING_MODEL = "qwen/qwen3-embedding-0.6b"


def _meta(
    label: str,
    description: str,
    *,
    public: bool = False,
    env_var: str | None = None,
) -> dict[str, Any]:
    """Build the json_schema_extra payload every config field carries."""
    return {
        "label": label,
        "description": description,
        "public": public,
        "env_var": env_var,
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
    """Document upload limits, enforced at the upload route."""

    max_upload_size_mb: int = Field(
        default=50,
        ge=1,
        le=1024,
        json_schema_extra=_meta(
            "Max upload size (MB)",
            "Uploads larger than this are rejected before ingestion.",
            public=True,
        ),
    )
    allowed_content_types: list[str] = Field(
        default_factory=lambda: [
            "text/plain",
            "text/markdown",
            "text/csv",
            "application/pdf",
        ],
        json_schema_extra=_meta(
            "Allowed content types",
            "Uploads whose MIME type is not in this list are rejected.",
            public=True,
        ),
    )


class ModelDefaults(BaseModel):
    """Default models used when a pipeline or chat session does not pin one."""

    default_chat_model: str = Field(
        default=_DEFAULT_CHAT_MODEL,
        min_length=1,
        json_schema_extra=_meta(
            "Default chat model",
            "OpenRouter model id used for chat when no session/pipeline "
            "override applies.",
            env_var="OPENROUTER_DEFAULT_CHAT_MODEL",
        ),
    )
    default_embedding_model: str = Field(
        default=_DEFAULT_EMBEDDING_MODEL,
        min_length=1,
        json_schema_extra=_meta(
            "Default embedding model",
            "OpenRouter model id used to embed documents and queries in "
            "newly created default pipelines.",
            env_var="OPENROUTER_DEFAULT_EMBEDDING_MODEL",
        ),
    )


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


class AppConfig(BaseModel):
    """Root runtime config: one field per section model."""

    auth: AuthSettings = Field(default_factory=AuthSettings)
    uploads: UploadSettings = Field(default_factory=UploadSettings)
    models: ModelDefaults = Field(default_factory=ModelDefaults)
    features: FeatureFlags = Field(default_factory=FeatureFlags)


class ConfigFieldKind(StrEnum):
    """Input widget kinds the admin settings renderer understands."""

    BOOL = "bool"
    INT = "int"
    STRING = "string"
    STRING_LIST = "string_list"


class ConfigFieldMeta(BaseModel):
    """Catalog entry describing one leaf config field."""

    key: str
    label: str
    description: str
    kind: ConfigFieldKind
    public: bool
    env_var: str | None


_KIND_BY_ANNOTATION: dict[Any, ConfigFieldKind] = {
    bool: ConfigFieldKind.BOOL,
    int: ConfigFieldKind.INT,
    str: ConfigFieldKind.STRING,
    list[str]: ConfigFieldKind.STRING_LIST,
}


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
            env_var = extra["env_var"]
            entries.append(
                ConfigFieldMeta(
                    key=f"{section_name}.{leaf_name}",
                    label=str(extra["label"]),
                    description=str(extra["description"]),
                    kind=kind,
                    public=bool(extra["public"]),
                    env_var=env_var if isinstance(env_var, str) else None,
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
            features=PublicFeatureFlags(
                umap_visualizations=config.features.umap_visualizations,
                chat_branching=config.features.chat_branching,
            ),
        )
