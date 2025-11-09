from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field
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
    openrouter_api_key: str = Field(validation_alias="OPENROUTER_API_KEY")
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
    pinecone_api_key: str = Field(validation_alias="PINECONE_API_KEY")
    pinecone_index_name: str = Field(
        default="transparent-rag",
        validation_alias="PINECONE_INDEX_NAME",
    )
    pinecone_cloud: str = Field(default="aws", validation_alias="PINECONE_CLOUD")
    pinecone_region: str = Field(default="us-east-1", validation_alias="PINECONE_REGION")

    # Database / storage
    database_url: str = Field(
        default="sqlite:///transparent_rag.db",
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_path.mkdir(parents=True, exist_ok=True)
    return settings
