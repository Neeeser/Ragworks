"""Prompt template storage: defaults, variable catalogs, and get/set helpers.

Owns "which template string is active" for a user (base prompt) or a collection
(system/tool prompt) -- the default templates, the catalog of variables each
scope exposes to clients, and the read/write helpers over `extra_metadata` /
`system_prompt_template`. Rendering those templates against live data lives in
`context.py` (context construction) and `render.py` (substitution).
"""

from __future__ import annotations

from typing import Any

from app.db import models
from app.schemas.prompts import PromptVariable

SYSTEM_PROMPT_METADATA_KEY = "system_prompt_template"

DEFAULT_BASE_PROMPT_TEMPLATE = (
    "You are Ragworks, a Retrieval-Augmented assistant focused on transparency "
    "and grounded answers.\n\n"
    "Clearly explain providers, parameters, and trade-offs when relevant.\n\n"
    "## Global guardrails\n"
    "1. Distinguish established facts from assumptions.\n"
    "2. Reflect on uncertainties, trade-offs, and missing context.\n"
    "3. Say when you lack enough context to answer confidently.\n\n"
    "## Session context\n"
    "- User: {{user.full_name}} ({{user.email}})\n"
    "- Generated at: {{datetime.iso}}\n"
)

BASE_PROMPT_VARIABLES: list[PromptVariable] = [
    PromptVariable(
        name="user.full_name",
        description="Full name from the authenticated user profile.",
        example="Avery Lee",
    ),
    PromptVariable(
        name="user.email",
        description="Email address for the signed-in user.",
        example="avery@example.com",
    ),
    PromptVariable(
        name="user.id",
        description="Internal UUID of the authenticated user.",
    ),
    PromptVariable(
        name="datetime.iso",
        description="Current UTC timestamp in ISO 8601 format.",
        example="2024-07-20T14:03:22+00:00",
    ),
    PromptVariable(
        name="datetime.date",
        description="Current UTC date.",
        example="2024-07-20",
    ),
    PromptVariable(
        name="datetime.time",
        description="Current UTC time.",
        example="14:03:22",
    ),
    PromptVariable(
        name="datetime.human",
        description="Human-readable UTC timestamp.",
        example="July 20, 2024 at 14:03 UTC",
    ),
]

COLLECTION_PROMPT_VARIABLES: list[PromptVariable] = [
    PromptVariable(
        name="collection.name",
        description="Collection display name.",
        example="Product Launch War Room",
    ),
    PromptVariable(
        name="collection.description",
        description="Collection description or 'N/A' when missing.",
        example="Live updates for Q3 roadmap prep.",
    ),
    PromptVariable(
        name="collection.tool_name",
        description="Tool function name for this collection.",
        example="pinecone_query_f47ac10b58cc4372a5670e02b2c3d479",
    ),
    PromptVariable(
        name="collection.embedding_model",
        description="Embedding model name configured for the ingestion pipeline.",
        example="text-embedding-3-large",
    ),
    PromptVariable(
        name="collection.chunk.strategy",
        description="Chunking strategy label configured in the ingestion pipeline.",
        example="token",
    ),
    PromptVariable(
        name="collection.chunk.size",
        description="Chunk size configured in the ingestion pipeline.",
        example="1024",
    ),
    PromptVariable(
        name="collection.chunk.overlap",
        description="Token overlap between consecutive chunks in the ingestion pipeline.",
        example="200",
    ),
    PromptVariable(
        name="collection.pinecone.index",
        description="Pinecone index configured in the ingestion pipeline.",
        example="ragworks-prod",
    ),
    PromptVariable(
        name="collection.pinecone.namespace",
        description="Namespace within the Pinecone index for this collection.",
        example="col-a1b2c3d4e5f6",
    ),
    PromptVariable(
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
    "- Chunking: {{collection.chunk.strategy}} "
    "({{collection.chunk.size}}/{{collection.chunk.overlap}})\n"
    "- Pinecone index: {{collection.pinecone.index}}\n"
    "- Namespace: {{collection.pinecone.namespace}}\n"
    "- Embedding dimension: {{metadata.embedding_dimension}}\n\n"
    "When you need grounded context, call {{collection.tool_name}} before answering.\n"
    "Cite the chunks you rely on and note uncertainties.\n"
)


def with_system_prompt_template(
    metadata: dict[str, Any],
    template: str,
) -> dict[str, Any]:
    """Return a NEW metadata dict with the template set (or cleared, if blank).

    Always builds a fresh dict, never mutates: JSON columns aren't wrapped in
    `MutableDict`, so in-place mutation is invisible to the session and would
    never be written (see app/AGENTS.md).
    """
    if template.strip():
        return {**metadata, SYSTEM_PROMPT_METADATA_KEY: template}
    return {key: value for key, value in metadata.items() if key != SYSTEM_PROMPT_METADATA_KEY}


def get_system_prompt_template(collection: models.Collection) -> str:
    """Return the system prompt template for a collection."""
    metadata = collection.extra_metadata or {}
    stored_value = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    if isinstance(stored_value, str):
        stripped = stored_value.strip()
        if stripped:
            return stored_value
    return DEFAULT_SYSTEM_PROMPT_TEMPLATE


def get_base_prompt_template(user: models.User | None) -> str:
    """Return the base system prompt template for a user."""
    if not user:
        return DEFAULT_BASE_PROMPT_TEMPLATE
    stored_value = (user.system_prompt_template or "").strip()
    return stored_value or DEFAULT_BASE_PROMPT_TEMPLATE


def prompt_variables_payload(scope: str = "collection") -> list[PromptVariable]:
    """Return prompt variable definitions for API clients."""
    return COLLECTION_PROMPT_VARIABLES if scope == "collection" else BASE_PROMPT_VARIABLES


def is_collection_prompt_custom(collection: models.Collection) -> bool:
    """Return True when a collection has a custom prompt template."""
    metadata = collection.extra_metadata or {}
    stored_value = metadata.get(SYSTEM_PROMPT_METADATA_KEY)
    return isinstance(stored_value, str) and bool(stored_value.strip())


def is_base_prompt_custom(user: models.User | None) -> bool:
    """Return True when a user has a custom base prompt template."""
    if not user:
        return False
    stored_value = user.system_prompt_template
    return bool(stored_value and stored_value.strip())
