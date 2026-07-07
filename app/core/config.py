"""Application configuration settings."""

from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application-wide configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        case_sensitive=False,
        extra="ignore",
    )

    # OpenRouter / LLM settings
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias="OPENROUTER_BASE_URL",
    )
    openrouter_site_url: str | None = Field(
        default=None,
        validation_alias="OPENROUTER_SITE_URL",
        description="Optional Referer header so the project ranks correctly on openrouter.ai",
    )
    openrouter_site_name: str | None = Field(
        default=None,
        validation_alias="OPENROUTER_SITE_NAME",
    )
    default_embedding_model: str = Field(
        default="qwen/qwen3-embedding-0.6b",
        validation_alias="OPENROUTER_DEFAULT_EMBEDDING_MODEL",
    )
    default_chat_model: str = Field(
        default="openai/gpt-oss-120b",
        validation_alias="OPENROUTER_DEFAULT_CHAT_MODEL",
    )
    openrouter_reasoning_effort: str | None = Field(
        default="medium",
        validation_alias="OPENROUTER_REASONING_EFFORT",
        description="Default reasoning effort (minimal/low/medium/high). Set empty to disable.",
    )

    # Pinecone
    pinecone_index_name: str = Field(
        default="ragworks",
        validation_alias="PINECONE_INDEX_NAME",
    )
    pinecone_cloud: str = Field(default="aws", validation_alias="PINECONE_CLOUD")
    pinecone_region: str = Field(default="us-east-1", validation_alias="PINECONE_REGION")

    # Database / storage
    database_url: str = Field(
        default="postgresql+psycopg://localhost:5432/ragworks",
        validation_alias="DATABASE_URL",
    )
    storage_path: Path = Field(
        default=Path("./storage"),
        validation_alias="FILE_STORAGE_PATH",
        description="Bulk document storage — large and reclaimable.",
    )
    config_path: Path = Field(
        default=Path("./config"),
        validation_alias="CONFIG_PATH",
        description=(
            "Small persistent app state (e.g. the auto-generated JWT secret). "
            "Deliberately separate from storage_path so clearing bulk document "
            "storage never destroys identity material."
        ),
    )

    # Auth / security
    jwt_secret_key: str = Field(
        validation_alias="JWT_SECRET_KEY",
        default="",
        description=(
            "Secret used to sign access tokens. Leave unset to auto-generate "
            "one on first boot, persisted under the storage path so it "
            "survives restarts and upgrades."
        ),
    )
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=60 * 24,
        validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES",
    )
    log_level: str | None = Field(
        default=None,
        validation_alias="LOG_LEVEL",
        description=(
            "Python logging level for application logs. Leave unset to use default "
            "FastAPI/uvicorn logging."
        ),
    )

    # Application mode / web
    debug: bool = Field(
        default=False,
        validation_alias="DEBUG",
        description=(
            "Development mode flag, off by default so a deployment is secure "
            "out of the box: unless DEBUG=true is set explicitly, startup fails "
            "fast on insecure defaults (e.g. an unset JWT secret) instead of "
            "silently running with them. Dev entry points (make server, the "
            "test suite) opt in."
        ),
    )
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        validation_alias="CORS_ORIGINS",
        description="Origins allowed to make credentialed cross-origin requests.",
    )

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        """Ensure the configured database URL points to Postgres."""
        normalized = (value or "").strip()
        if not normalized.lower().startswith("postgresql"):
            raise ValueError("DATABASE_URL must use a postgres connection string.")
        return normalized

    @field_validator("openrouter_base_url")
    @classmethod
    def normalize_openrouter_base_url(cls, value: str) -> str:
        """Normalize the OpenRouter base URL to the API host."""
        normalized = (value or "").strip().rstrip("/")
        if not normalized:
            raise ValueError("OPENROUTER_BASE_URL must be set.")
        if not normalized.endswith("/api/v1"):
            normalized = f"{normalized}/api/v1"
        return normalized

    @model_validator(mode="after")
    def validate_jwt_secret_outside_debug(self) -> Settings:
        """Fail fast on the known-placeholder JWT secret once debug mode is off.

        An *unset* secret is fine — `get_settings` auto-generates and persists
        one. But an explicit `changeme` reaching a non-debug (i.e. deployed)
        process would mean every issued access token is forgeable by anyone
        who has read this file.
        """
        if self.debug is False and self.jwt_secret_key == "changeme":
            raise ValueError(
                "JWT_SECRET_KEY must be set to a non-default value when DEBUG is false."
            )
        return self


def _load_or_create_jwt_secret(config_path: Path) -> str:
    """Return the install's auto-generated JWT secret, minting it on first boot.

    The secret lives in the config path — a persistent volume in Docker,
    separate from bulk document storage — so restarts, image upgrades, and
    document-volume cleanups all keep issued tokens valid. Created with
    owner-only permissions; a concurrent first boot that loses the exclusive
    create simply reads the winner's secret.
    """
    secret_file = config_path / ".jwt-secret"
    try:
        fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        existing = secret_file.read_text(encoding="utf-8").strip()
        if existing:
            return existing
        # Corrupt (empty) secret file: re-mint rather than sign with "".
        fd = os.open(secret_file, os.O_WRONLY | os.O_TRUNC, 0o600)
    secret = secrets.token_hex(32)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(secret)
    return secret


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings.

    Owns the boot-time side effects: creating the storage/config directories
    and resolving an unset JWT secret to the persisted auto-generated one.
    """
    settings = Settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    settings.config_path.mkdir(parents=True, exist_ok=True)
    if not settings.jwt_secret_key:
        settings.jwt_secret_key = _load_or_create_jwt_secret(settings.config_path)
    return settings
