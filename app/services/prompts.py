"""Prompt templates and rendering helpers."""

# pylint: disable=duplicate-code

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional
from uuid import UUID

from app.db import models
from app.pipelines.config import IngestionPipelineSettings, RetrievalPipelineSettings
from app.utils.time import utc_now

SYSTEM_PROMPT_METADATA_KEY = "system_prompt_template"

DEFAULT_BASE_PROMPT_TEMPLATE = (
    "You are TransparentRAG, a Retrieval-Augmented assistant focused on transparency "
    "and grounded answers.\n\n"
    "Follow the tool instructions for any enabled tools, cite the chunks you rely on, "
    "and clearly explain providers, parameters, and trade-offs.\n\n"
    "## Global guardrails\n"
    "1. Cite every retrieved chunk you rely on.\n"
    "2. Call the appropriate tool before answering grounded questions.\n"
    "3. Reflect on uncertainties, trade-offs, and missing context.\n"
    "4. If no tools are enabled, answer from general knowledge and say so.\n\n"
    "## Session context\n"
    "- User: {{user.full_name}} ({{user.email}})\n"
    "- Generated at: {{datetime.iso}}\n"
)


@dataclass(frozen=True)
class PromptVariableDefinition:
    """Definition for prompt template variables."""

    name: str
    description: str
    example: Optional[str] = None


BASE_PROMPT_VARIABLES: List[PromptVariableDefinition] = [
    PromptVariableDefinition(
        name="user.full_name",
        description="Full name from the authenticated user profile.",
        example="Avery Lee",
    ),
    PromptVariableDefinition(
        name="user.email",
        description="Email address for the signed-in user.",
        example="avery@example.com",
    ),
    PromptVariableDefinition(
        name="user.id",
        description="Internal UUID of the authenticated user.",
    ),
    PromptVariableDefinition(
        name="datetime.iso",
        description="Current UTC timestamp in ISO 8601 format.",
        example="2024-07-20T14:03:22+00:00",
    ),
    PromptVariableDefinition(
        name="datetime.date",
        description="Current UTC date.",
        example="2024-07-20",
    ),
    PromptVariableDefinition(
        name="datetime.time",
        description="Current UTC time.",
        example="14:03:22",
    ),
    PromptVariableDefinition(
        name="datetime.human",
        description="Human-readable UTC timestamp.",
        example="July 20, 2024 at 14:03 UTC",
    ),
]

COLLECTION_PROMPT_VARIABLES: List[PromptVariableDefinition] = [
    PromptVariableDefinition(
        name="collection.name",
        description="Collection display name.",
        example="Product Launch War Room",
    ),
    PromptVariableDefinition(
        name="collection.description",
        description="Collection description or 'N/A' when missing.",
        example="Live updates for Q3 roadmap prep.",
    ),
    PromptVariableDefinition(
        name="collection.tool_name",
        description="Tool function name for this collection.",
        example="pinecone_query_f47ac10b58cc4372a5670e02b2c3d479",
    ),
    PromptVariableDefinition(
        name="collection.embedding_model",
        description="Embedding model name configured for the ingestion pipeline.",
        example="text-embedding-3-large",
    ),
    PromptVariableDefinition(
        name="collection.chat_model",
        description="Default chat model used by the retrieval pipeline.",
        example="meta-llama/llama-3.1-70b-instruct",
    ),
    PromptVariableDefinition(
        name="collection.chunk.strategy",
        description="Chunking strategy label configured in the ingestion pipeline.",
        example="token",
    ),
    PromptVariableDefinition(
        name="collection.chunk.size",
        description="Chunk size configured in the ingestion pipeline.",
        example="1024",
    ),
    PromptVariableDefinition(
        name="collection.chunk.overlap",
        description="Token overlap between consecutive chunks in the ingestion pipeline.",
        example="200",
    ),
    PromptVariableDefinition(
        name="collection.context_window",
        description="Context window configured for the retrieval pipeline.",
        example="8192",
    ),
    PromptVariableDefinition(
        name="collection.pinecone.index",
        description="Pinecone index configured in the ingestion pipeline.",
        example="transparentrag-prod",
    ),
    PromptVariableDefinition(
        name="collection.pinecone.namespace",
        description="Namespace within the Pinecone index for this collection.",
        example="col-a1b2c3d4e5f6",
    ),
    PromptVariableDefinition(
        name="metadata.embedding_dimension",
        description="Embedding vector dimension discovered at collection creation.",
        example="3072",
    ),
    *BASE_PROMPT_VARIABLES,
]

DEFAULT_SYSTEM_PROMPT_TEMPLATE = (
    "## Tool context: {{collection.name}}\n"
    "- Tool name: {{collection.tool_name}}\n"
    "- Description: {{collection.description}}\n"
    "- Embedding model: {{collection.embedding_model}}\n"
    "- Chat model: {{collection.chat_model}}\n"
    "- Chunking: {{collection.chunk.strategy}} "
    "({{collection.chunk.size}}/{{collection.chunk.overlap}})\n"
    "- Context window: {{collection.context_window}} tokens\n"
    "- Pinecone index: {{collection.pinecone.index}}\n"
    "- Namespace: {{collection.pinecone.namespace}}\n"
    "- Embedding dimension: {{metadata.embedding_dimension}}\n\n"
    "When you need grounded context, call {{collection.tool_name}} before answering.\n"
    "Cite the chunks you rely on and note uncertainties.\n"
)

_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


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


def system_prompt_context(
    collection: models.Collection,
    user: Optional[models.User],
    *,
    ingestion_settings: Optional[IngestionPipelineSettings] = None,
    retrieval_settings: Optional[RetrievalPipelineSettings] = None,
    tool_name: Optional[str] = None,
) -> Dict[str, str]:
    """Build the rendering context for system prompt templates."""
    now = utc_now()
    metadata = collection.extra_metadata or {}
    user_display_name = getattr(user, "full_name", None) or getattr(user, "email", None)
    chunk_strategy = (
        ingestion_settings.chunk_strategy.value
        if ingestion_settings and hasattr(ingestion_settings.chunk_strategy, "value")
        else str(ingestion_settings.chunk_strategy)
        if ingestion_settings
        else None
    )
    embedding_model = (
        ingestion_settings.embedding_model
        if ingestion_settings
        else retrieval_settings.embedding_model
        if retrieval_settings
        else None
    )
    pinecone_index = ingestion_settings.index_name if ingestion_settings else None
    pinecone_namespace = ingestion_settings.namespace if ingestion_settings else None

    context: Dict[str, str] = {
        "collection.id": str(collection.id),
        "collection.name": _stringify(collection.name, "Untitled collection"),
        "collection.description": _stringify(collection.description),
        "collection.tool_name": _stringify(tool_name or collection_tool_name(collection.id)),
        "collection.embedding_model": _stringify(embedding_model),
        "collection.chat_model": _stringify(
            retrieval_settings.chat_model if retrieval_settings else None
        ),
        "collection.context_window": _stringify(
            retrieval_settings.context_window if retrieval_settings else None
        ),
        "collection.chunk.strategy": _stringify(chunk_strategy),
        "collection.chunk.size": _stringify(
            ingestion_settings.chunk_size if ingestion_settings else None
        ),
        "collection.chunk.overlap": _stringify(
            ingestion_settings.chunk_overlap if ingestion_settings else None
        ),
        "collection.pinecone.index": _stringify(pinecone_index),
        "collection.pinecone.namespace": _stringify(pinecone_namespace),
        "metadata.embedding_dimension": _stringify(
            ingestion_settings.dimension if ingestion_settings else None
        ),
        "user.full_name": _stringify(user_display_name, "Anonymous user"),
        "user.email": _stringify(getattr(user, "email", None), "unknown@example.com"),
        "user.id": _stringify(getattr(user, "id", None)),
        "datetime.iso": now.isoformat(),
        "datetime.date": now.date().isoformat(),
        "datetime.time": now.time().strftime("%H:%M:%S"),
        "datetime.human": now.strftime("%B %d, %Y at %H:%M UTC"),
    }

    for key, value in metadata.items():
        context[f"metadata.{key}"] = _stringify(value)

    return context


def base_prompt_context(user: Optional[models.User]) -> Dict[str, str]:
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


def collection_tool_name(collection_id: UUID) -> str:
    """Return the tool function name for a collection."""
    return f"pinecone_query_{collection_id.hex}"


def get_system_prompt_template(collection: models.Collection) -> str:
    """Return the system prompt template for a collection."""
    metadata = collection.extra_metadata or {}
    stored_value = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    if isinstance(stored_value, str):
        stripped = stored_value.strip()
        if stripped:
            return stored_value
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE


def get_base_prompt_template(user: Optional[models.User]) -> str:
    """Return the base system prompt template for a user."""
    if not user:
        return DEFAULT_BASE_PROMPT_TEMPLATE
    stored_value = (user.system_prompt_template or "").strip()
    return stored_value or DEFAULT_BASE_PROMPT_TEMPLATE


def apply_prompt_template(template: str, context: Dict[str, str]) -> str:
    """Apply context variables to a prompt template."""
    def _replace(match: re.Match[str]) -> str:
        """Replace template placeholders with context values."""
        key = match.group(1)
        return context.get(key, match.group(0))

    return _PLACEHOLDER_PATTERN.sub(_replace, template)


def render_system_prompt(
    tool_contexts: List[Dict[str, object]],
    user: Optional[models.User],
) -> str:
    """Render the final system prompt for base and tool contexts."""
    base_template = get_base_prompt_template(user)
    base_context = base_prompt_context(user)
    sections = [apply_prompt_template(base_template, base_context)]
    for context in tool_contexts:
        template = context.get("template")
        render_context = context.get("context")
        if isinstance(template, str) and isinstance(render_context, dict):
            sections.append(apply_prompt_template(template, render_context))
    return "\n\n".join(section.strip() for section in sections if str(section).strip())


def prompt_variables_payload(scope: str = "collection") -> List[Dict[str, Optional[str]]]:
    """Return prompt variable definitions for API clients."""
    variables = COLLECTION_PROMPT_VARIABLES if scope == "collection" else BASE_PROMPT_VARIABLES
    return [
        {
            "name": variable.name,
            "description": variable.description,
            "example": variable.example,
        }
        for variable in variables
    ]


def is_collection_prompt_custom(collection: models.Collection) -> bool:
    """Return True when a collection has a custom prompt template."""
    metadata = collection.extra_metadata or {}
    stored_value = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    return isinstance(stored_value, str) and bool(stored_value.strip())


def is_base_prompt_custom(user: Optional[models.User]) -> bool:
    """Return True when a user has a custom base prompt template."""
    if not user:
        return False
    stored_value = user.system_prompt_template
    return bool(stored_value and stored_value.strip())
