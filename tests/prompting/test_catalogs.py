"""Per-context variable catalogs: membership and unknown-name reporting."""

from __future__ import annotations

from app.prompting import catalog_for
from app.schemas.enums import PromptContext


def test_chat_base_allows_user_and_datetime_only() -> None:
    catalog = catalog_for(PromptContext.CHAT_BASE)
    assert catalog.allows("user.email")
    assert catalog.allows("datetime.iso")
    assert not catalog.allows("text")
    assert not catalog.allows("collection.name")


def test_chat_tool_extends_base_with_collection_and_namespaces() -> None:
    catalog = catalog_for(PromptContext.CHAT_TOOL)
    assert catalog.allows("collection.name")
    assert catalog.allows("user.email")
    assert catalog.allows("metadata.team")
    assert catalog.allows("collection.id")


def test_node_contexts_mirror_shell_placeholder_sets() -> None:
    transform = catalog_for(PromptContext.NODE_TRANSFORM)
    assert transform.allows("text")
    assert transform.allows("document_text")
    assert transform.allows("metadata.author")
    assert not transform.allows("items")

    rerank = catalog_for(PromptContext.NODE_RERANK)
    assert rerank.allows("items")
    assert rerank.allows("query")
    assert not rerank.allows("document_text")

    generate = catalog_for(PromptContext.NODE_GENERATE)
    assert generate.allows("text")
    assert not generate.allows("items")


def test_unknown_variables_sorted_and_namespace_aware() -> None:
    catalog = catalog_for(PromptContext.NODE_TRANSFORM)
    unknown = catalog.unknown_variables({"text", "zeta", "alpha", "metadata.year"})
    assert unknown == ["alpha", "zeta"]
