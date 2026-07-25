"""The unauthenticated public config shape served at `GET /api/config`.

Its own module, not a section of `app_config.py`: this is the *wire subset* the
frontend may read before signing in, built explicitly from the full config so a
new field can never reach it by accident — the exact inverse of the catalog next
door, which exists to expose everything to admins.
"""

from __future__ import annotations

from pydantic import BaseModel

from app.schemas.app_config import AppConfig, iter_config_fields

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
    mcp_access: bool


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
                mcp_access=config.features.mcp_access,
            ),
        )
