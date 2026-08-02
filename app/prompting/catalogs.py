"""Per-context variable catalogs.

Each `PromptContext` binds the set of variables a prompt may reference:
exact names (with descriptions and examples the editor renders) plus open
namespaces (`metadata.*`) whose keys are corpus-defined. Validation is
strict against the catalog — a name outside it is an error, in the editor
and at save time, never a silent pass-through.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas.enums import PromptContext
from app.schemas.prompts import PromptVariable

_USER_DATETIME_VARIABLES: tuple[PromptVariable, ...] = (
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
)

_COLLECTION_VARIABLES: tuple[PromptVariable, ...] = (
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
        example="search_product_launch_war_room",
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
        description="Vector index configured in the ingestion pipeline.",
        example="ragworks-prod",
    ),
    PromptVariable(
        name="collection.pinecone.namespace",
        description="Namespace within the vector index for this collection.",
        example="col-a1b2c3d4e5f6",
    ),
    PromptVariable(
        name="metadata.embedding_dimension",
        description="Embedding vector dimension discovered at collection creation.",
        example="3072",
    ),
)

_NODE_TEXT = PromptVariable(
    name="text",
    description="The current item's text (the chunk being processed).",
    example="Quarterly revenue grew 14% on subscription strength, driven by annual plans.",
)
_NODE_QUERY = PromptVariable(
    name="query",
    description="The run's query text. Unavailable on ingestion runs.",
    example="What drove revenue growth?",
)
_NODE_DOCUMENT_TEXT = PromptVariable(
    name="document_text",
    description="Full text of the document wired into the node's document input.",
    example="(the whole parsed document)",
)
_NODE_ITEMS = PromptVariable(
    name="items",
    description="Numbered list of every item in the batch ([1] …, [2] …).",
    example="[1] First chunk text\n\n[2] Second chunk text",
)

_METADATA_NAMESPACE_ITEM = "Metadata value on the current item, by key."
_METADATA_NAMESPACE_COLLECTION = "Metadata value stored on the collection, by key."


@dataclass(frozen=True)
class VariableNamespace:
    """An open variable namespace (`metadata.*`) whose keys are data-defined."""

    prefix: str
    description: str
    example_name: str = ""

    def allows(self, name: str) -> bool:
        """Return True when `name` is a well-formed member of this namespace."""
        head = f"{self.prefix}."
        if not name.startswith(head):
            return False
        key = name[len(head) :]
        return bool(key) and " " not in key


@dataclass(frozen=True)
class VariableCatalog:
    """Every variable one prompt context exposes."""

    variables: tuple[PromptVariable, ...]
    namespaces: tuple[VariableNamespace, ...] = field(default=())

    def allows(self, name: str) -> bool:
        """Return True when a template may reference `name` in this context."""
        if any(variable.name == name for variable in self.variables):
            return True
        return any(namespace.allows(name) for namespace in self.namespaces)

    def unknown_variables(self, names: set[str]) -> list[str]:
        """Return the referenced names this context cannot supply, sorted."""
        return sorted(name for name in names if not self.allows(name))


_ITEM_METADATA = VariableNamespace(
    prefix="metadata",
    description=_METADATA_NAMESPACE_ITEM,
    example_name="metadata.author",
)

_CATALOGS: dict[PromptContext, VariableCatalog] = {
    PromptContext.CHAT_BASE: VariableCatalog(variables=_USER_DATETIME_VARIABLES),
    PromptContext.CHAT_TOOL: VariableCatalog(
        variables=(*_COLLECTION_VARIABLES, *_USER_DATETIME_VARIABLES),
        namespaces=(
            VariableNamespace(
                prefix="metadata",
                description=_METADATA_NAMESPACE_COLLECTION,
                example_name="metadata.team",
            ),
            VariableNamespace(
                prefix="collection",
                description="Additional collection attribute, by key.",
                example_name="collection.id",
            ),
        ),
    ),
    PromptContext.NODE_TRANSFORM: VariableCatalog(
        variables=(_NODE_TEXT, _NODE_QUERY, _NODE_DOCUMENT_TEXT),
        namespaces=(_ITEM_METADATA,),
    ),
    PromptContext.NODE_RERANK: VariableCatalog(
        variables=(_NODE_ITEMS, _NODE_QUERY),
        namespaces=(_ITEM_METADATA,),
    ),
    PromptContext.NODE_GENERATE: VariableCatalog(
        variables=(_NODE_TEXT, _NODE_QUERY),
        namespaces=(_ITEM_METADATA,),
    ),
}


def catalog_for(context: PromptContext) -> VariableCatalog:
    """Return the variable catalog one prompt context exposes."""
    return _CATALOGS[context]
