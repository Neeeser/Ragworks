"""Application configuration settings."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional, cast

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application-wide configuration loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # OpenRouter / LLM settings
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        validation_alias="OPENROUTER_BASE_URL",
    )
    openrouter_site_url: Optional[str] = Field(
        default=None,
        validation_alias="OPENROUTER_SITE_URL",
        description="Optional Referer header so the project ranks correctly on openrouter.ai",
    )
    openrouter_site_name: Optional[str] = Field(
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
    openrouter_reasoning_effort: Optional[str] = Field(
        default="medium",
        validation_alias="OPENROUTER_REASONING_EFFORT",
        description="Default reasoning effort (minimal/low/medium/high). Set empty to disable.",
    )

    # Pinecone
    pinecone_index_name: str = Field(
        default="transparent-rag",
        validation_alias="PINECONE_INDEX_NAME",
    )
    pinecone_cloud: str = Field(default="aws", validation_alias="PINECONE_CLOUD")
    pinecone_region: str = Field(default="us-east-1", validation_alias="PINECONE_REGION")

    # Database / storage
    database_url: str = Field(
        default="postgresql+psycopg://localhost:5432/transparentrag",
        validation_alias="DATABASE_URL",
    )
    storage_path: Path = Field(
        default=Path("./storage"),
        validation_alias="FILE_STORAGE_PATH",
    )

    # Auth / security
    jwt_secret_key: str = Field(validation_alias="JWT_SECRET_KEY", default="changeme")
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(
        default=60 * 24,
        validation_alias="ACCESS_TOKEN_EXPIRE_MINUTES",
    )
    log_level: Optional[str] = Field(
        default=None,
        validation_alias="LOG_LEVEL",
        description=(
            "Python logging level for application logs. Leave unset to use default "
            "FastAPI/uvicorn logging."
        ),
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings."""
    settings = Settings()
    storage_path = cast(Path, settings.storage_path)
    storage_path.mkdir(parents=True, exist_ok=True)  # pylint: disable=no-member
    return settings
