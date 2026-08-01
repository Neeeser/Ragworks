"""Prompt template rendering behavior."""

from __future__ import annotations

import pytest

from app.pipelines.llm.prompts import (
    PromptContext,
    PromptTemplateError,
    referenced_placeholders,
    render,
    render_items_block,
)


def test_renders_base_placeholders_and_metadata() -> None:
    context = PromptContext(
        text="chunk body",
        query="what is x?",
        document_text="whole doc",
        metadata={"author": "Smith", "year": 2020},
    )
    rendered = render(
        "Q: {query}\nChunk: {text}\nDoc: {document_text}\nBy {metadata.author} ({metadata.year})",
        context,
    )
    assert rendered == "Q: what is x?\nChunk: chunk body\nDoc: whole doc\nBy Smith (2020)"


def test_missing_metadata_key_renders_empty() -> None:
    assert render("[{metadata.absent}]", PromptContext()) == "[]"


def test_escaped_braces_render_literally() -> None:
    assert render("{{not a placeholder}}", PromptContext()) == "{not a placeholder}"


def test_unknown_placeholder_rejected() -> None:
    with pytest.raises(PromptTemplateError, match="chunk_txt"):
        render("{chunk_txt}", PromptContext(text="x"))


def test_unavailable_placeholder_names_the_reason() -> None:
    with pytest.raises(PromptTemplateError, match="no query"):
        render("{query}", PromptContext(text="x"))
    with pytest.raises(PromptTemplateError, match="document"):
        render("{document_text}", PromptContext(text="x"))


def test_referenced_placeholders_lists_names() -> None:
    names = referenced_placeholders("{text} {metadata.author} {{literal}} {query}")
    assert names == {"text", "metadata.author", "query"}


def test_referenced_placeholders_rejects_malformed() -> None:
    with pytest.raises(PromptTemplateError):
        referenced_placeholders("{not valid}")


def test_items_block_numbers_from_one() -> None:
    assert render_items_block(["alpha", "beta"]) == "[1] alpha\n\n[2] beta"
