"""Prompt render-context construction from domain models.

Builds the `{{placeholder}} -> value` mapping `render.apply_prompt_template`
substitutes into a template string. `system_prompt_context` extends
`base_prompt_context`'s user/datetime keys with collection- and
pipeline-settings-derived ones rather than duplicating them.
"""

from __future__ import annotations

import json
import re

from app.db import models
from app.pipelines.settings import IngestionPipelineSettings, RetrievalPipelineSettings
from app.utils.time import utc_now


def _stringify(value: object, default: str = "N/A") -> str:
    """Coerce values into string representations for prompt templates."""
    if value is None:
        return default
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or default
    try:
        return json.dumps(value, default=str)
    except TypeError:
        return default


def collection_tool_name(collection_name: str) -> str:
    """Return a provider-safe, readable search tool name for a collection."""
    slug = re.sub(r"[^a-z0-9]+", "_", collection_name.lower()).strip("_")
    return f"search_{slug or 'collection'}"


def _chunk_strategy_label(ingestion_settings: IngestionPipelineSettings | None) -> str | None:
    """Return the chunk strategy label for prompt context.

    `chunk_strategy` is a `ChunkStrategy` (str) enum member on the settings
    dataclass -- always has `.value` once ingestion settings are resolved, so
    there is nothing to defend against beyond the settings being absent.
    """
    if ingestion_settings is None:
        return None
    return ingestion_settings.chunk_strategy.value


def base_prompt_context(user: models.User | None) -> dict[str, str]:
    """Build the rendering context for base prompt templates."""
    now = utc_now()
    user_display_name = getattr(user, "full_name", None) or getattr(user, "email", None)
    return {
        "user.full_name": _stringify(user_display_name, "Anonymous user"),
        "user.email": _stringify(getattr(user, "email", None), "unknown@example.com"),
        "user.id": _stringify(getattr(user, "id", None)),
        "datetime.iso": now.isoformat(),
        "datetime.date": now.date().isoformat(),
        "datetime.time": now.time().strftime("%H:%M:%S"),
        "datetime.human": now.strftime("%B %d, %Y at %H:%M UTC"),
    }


def system_prompt_context(
    collection: models.Collection,
    user: models.User | None,
    *,
    ingestion_settings: IngestionPipelineSettings | None = None,
    retrieval_settings: RetrievalPipelineSettings | None = None,
    tool_name: str | None = None,
) -> dict[str, str]:
    """Build the rendering context for system prompt templates."""
    metadata = collection.extra_metadata or {}
    embedding_model = (
        ingestion_settings.embedding_model
        if ingestion_settings
        else retrieval_settings.embedding_model
        if retrieval_settings
        else None
    )

    context = base_prompt_context(user)
    context.update(
        {
            "collection.id": str(collection.id),
            "collection.name": _stringify(collection.name, "Untitled collection"),
            "collection.description": _stringify(collection.description),
            "collection.tool_name": _stringify(tool_name or collection_tool_name(collection.name)),
            "collection.embedding_model": _stringify(embedding_model),
            "collection.chunk.strategy": _stringify(_chunk_strategy_label(ingestion_settings)),
            "collection.chunk.size": _stringify(
                ingestion_settings.chunk_size if ingestion_settings else None
            ),
            "collection.chunk.overlap": _stringify(
                ingestion_settings.chunk_overlap if ingestion_settings else None
            ),
            "collection.pinecone.index": _stringify(
                ingestion_settings.index_name if ingestion_settings else None
            ),
            "collection.pinecone.namespace": _stringify(
                ingestion_settings.namespace if ingestion_settings else None
            ),
            "metadata.embedding_dimension": _stringify(
                ingestion_settings.dimension if ingestion_settings else None
            ),
        }
    )
    for key, value in metadata.items():
        context[f"metadata.{key}"] = _stringify(value)

    return context
