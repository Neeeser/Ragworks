"""Wire shapes unique to OpenRouter.

OpenRouter speaks the shared Chat Completions dialect for chat, embeddings, and
reranking — those payloads live in `app/schemas/chat_completions.py`. What
remains here is the account metadata OpenRouter publishes at `GET /key`, which
has no counterpart at any other provider.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.schemas.chat_completions import NumberLike


class OpenRouterKeyRateLimit(BaseModel):
    """Legacy rate-limit block on key metadata; OpenRouter always returns -1 here."""

    model_config = ConfigDict(extra="allow")

    requests: NumberLike | None = None
    interval: str | None = None
    note: str | None = None


class OpenRouterKeyData(BaseModel):
    """Metadata for the API key associated with the current session.

    Shape per `docs/external-api/openrouter/api/api-reference/
    api-keys/get-current-key.md` (GET /key).
    """

    model_config = ConfigDict(extra="allow")

    label: str | None = None
    limit: NumberLike | None = None
    usage: NumberLike | None = None
    usage_daily: NumberLike | None = None
    usage_weekly: NumberLike | None = None
    usage_monthly: NumberLike | None = None
    byok_usage: NumberLike | None = None
    byok_usage_daily: NumberLike | None = None
    byok_usage_weekly: NumberLike | None = None
    byok_usage_monthly: NumberLike | None = None
    is_free_tier: bool | None = None
    is_provisioning_key: bool | None = None
    limit_remaining: NumberLike | None = None
    limit_reset: str | None = None
    include_byok_in_limit: bool | None = None
    expires_at: str | None = None
    rate_limit: OpenRouterKeyRateLimit | None = None


class OpenRouterKeyInfo(BaseModel):
    """Top-level response from `GET /key` (current API key metadata)."""

    model_config = ConfigDict(extra="allow")

    data: OpenRouterKeyData
