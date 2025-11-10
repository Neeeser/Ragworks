from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Dict, List, Optional

from app.db import models
from app.utils.time import utc_now

SYSTEM_PROMPT_METADATA_KEY = "system_prompt_template"


@dataclass(frozen=True)
class PromptVariableDefinition:
    name: str
    description: str
    example: Optional[str] = None


PROMPT_VARIABLES: List[PromptVariableDefinition] = [
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
        name="collection.embedding_model",
        description="Embedding model name configured for this collection.",
        example="text-embedding-3-large",
    ),
    PromptVariableDefinition(
        name="collection.chat_model",
        description="Default chat model used when no override is provided.",
        example="meta-llama/llama-3.1-70b-instruct",
    ),
    PromptVariableDefinition(
        name="collection.chunk.strategy",
        description="Chunking strategy label.",
        example="token",
    ),
    PromptVariableDefinition(
        name="collection.chunk.size",
        description="Chunk size configured for ingestion.",
        example="1024",
    ),
    PromptVariableDefinition(
        name="collection.chunk.overlap",
        description="Token overlap between consecutive chunks.",
        example="200",
    ),
    PromptVariableDefinition(
        name="collection.context_window",
        description="Context window available for the active chat model.",
        example="8192",
    ),
    PromptVariableDefinition(
        name="collection.pinecone.index",
        description="Pinecone index backing this collection.",
        example="transparentrag-prod",
    ),
    PromptVariableDefinition(
        name="collection.pinecone.namespace",
        description="Namespace within the Pinecone index.",
        example="col-a1b2c3d4e5f6",
    ),
    PromptVariableDefinition(
        name="metadata.embedding_dimension",
        description="Embedding vector dimension discovered at collection creation.",
        example="3072",
    ),
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

DEFAULT_SYSTEM_PROMPT_TEMPLATE = """You are TransparentRAG, a Retrieval-Augmented assistant focused on transparency and grounded answers.

Use the pinecone_query tool whenever you need fresh context, cite the chunks you rely on, and clearly explain providers, parameters, and trade-offs.

## Dataset metadata
- Collection: {{collection.name}}
- Description: {{collection.description}}
- Embedding model: {{collection.embedding_model}}
- Chat model: {{collection.chat_model}}
- Chunking: {{collection.chunk.strategy}} ({{collection.chunk.size}}/{{collection.chunk.overlap}})
- Context window: {{collection.context_window}} tokens
- Pinecone index: {{collection.pinecone.index}} • Namespace: {{collection.pinecone.namespace}}
- Embedding dimension: {{metadata.embedding_dimension}}

## Session context
- User: {{user.full_name}} ({{user.email}})
- Generated at: {{datetime.iso}}

## Guardrails
1. Cite every retrieved chunk you rely on.
2. Call pinecone_query before answering grounded questions.
3. Reflect on uncertainties, trade-offs, and missing context.
"""

_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")


def _stringify(value: object, default: str = "N/A") -> str:
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


def system_prompt_context(collection: models.Collection, user: Optional[models.User]) -> Dict[str, str]:
    now = utc_now()
    chunk_strategy = (
        collection.chunk_strategy.value
        if hasattr(collection.chunk_strategy, "value")
        else str(collection.chunk_strategy)
    )
    metadata = collection.extra_metadata or {}

    context: Dict[str, str] = {
        "collection.id": str(collection.id),
        "collection.name": _stringify(collection.name, "Untitled collection"),
        "collection.description": _stringify(collection.description),
        "collection.embedding_model": _stringify(collection.embedding_model),
        "collection.chat_model": _stringify(collection.chat_model),
        "collection.context_window": _stringify(collection.context_window),
        "collection.chunk.strategy": _stringify(chunk_strategy),
        "collection.chunk.size": _stringify(collection.chunk_size),
        "collection.chunk.overlap": _stringify(collection.chunk_overlap),
        "collection.pinecone.index": _stringify(collection.pinecone_index),
        "collection.pinecone.namespace": _stringify(collection.pinecone_namespace),
        "metadata.embedding_dimension": _stringify(metadata.get("embedding_dimension")),
        "user.full_name": _stringify(getattr(user, "full_name", None) or getattr(user, "email", None), "Anonymous user"),
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


def get_system_prompt_template(collection: models.Collection) -> str:
    metadata = collection.extra_metadata or {}
    stored_value = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    if isinstance(stored_value, str):
        stripped = stored_value.strip()
        if stripped:
            return stored_value
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE


def apply_prompt_template(template: str, context: Dict[str, str]) -> str:
    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return context.get(key, match.group(0))

    return _PLACEHOLDER_PATTERN.sub(_replace, template)


def render_system_prompt(collection: models.Collection, user: Optional[models.User]) -> str:
    template = get_system_prompt_template(collection)
    context = system_prompt_context(collection, user)
    return apply_prompt_template(template, context)


def prompt_variables_payload() -> List[Dict[str, Optional[str]]]:
    return [
        {
            "name": variable.name,
            "description": variable.description,
            "example": variable.example,
        }
        for variable in PROMPT_VARIABLES
    ]
