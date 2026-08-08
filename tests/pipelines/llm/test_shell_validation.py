"""Static validation shared by the LLM node shells."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.nodes.llm_generate import LlmGenerateNode
from app.pipelines.nodes.llm_rerank import LlmRerankNode
from app.pipelines.nodes.llm_transform import LlmTransformNode
from app.pipelines.registry import default_registry

CONNECTION = str(uuid4())


def _node(node_type: str, prompt: str, **extra: object) -> PipelineNodeDefinition:
    config: dict[str, object] = {
        "connection_id": CONNECTION,
        "model_name": "stub-model",
        "prompt": prompt,
        **extra,
    }
    return PipelineNodeDefinition(id="llm-1", type=node_type, name="LLM", config=config)


def _issues(node_class: type, node: PipelineNodeDefinition) -> list[str]:
    definition = PipelineDefinition(nodes=[node], edges=[])
    return [
        f"{issue.severity}:{issue.field}:{issue.message}"
        for issue in node_class.validation_issues_for_node(node, definition, default_registry())
    ]


ITEMS_FIELD = [
    {"name": "queries", "type": "string_list", "description": "", "target": {"kind": "items"}}
]
TEXT_FIELD = [{"name": "summary", "type": "string", "description": "", "target": {"kind": "text"}}]
SCORE_FIELD = [{"name": "score", "type": "number", "description": "", "target": {"kind": "score"}}]


class TestPayloadPlaceholder:
    """A template that reads nothing from its item is flagged."""

    def test_generate_prompt_without_the_item_text_warns(self) -> None:
        node = _node("llm.generate", "Rewrite the query.", output_fields=ITEMS_FIELD)
        warnings = [issue for issue in _issues(LlmGenerateNode, node) if issue.startswith("warning")]
        assert len(warnings) == 1
        assert "every item gets the same prompt" in warnings[0]
        assert "{{text}}" in warnings[0]

    def test_generate_prompt_using_the_item_text_is_clean(self) -> None:
        node = _node("llm.generate", "Rewrite: {{text}}", output_fields=ITEMS_FIELD)
        assert _issues(LlmGenerateNode, node) == []

    def test_transform_reading_only_item_metadata_is_clean(self) -> None:
        # `metadata.<key>` varies per item, so it is a payload reference too.
        node = _node("llm.transform", "Summarize {{metadata.title}}.", output_fields=TEXT_FIELD)
        assert _issues(LlmTransformNode, node) == []

    def test_reranker_reads_the_item_list_not_the_item_text(self) -> None:
        # `{{text}}` is not even available to the rerank shell — its payload
        # placeholder is the whole list it ranks.
        node = _node("llm.rerank", "Rank these for {{query}}.", output_fields=SCORE_FIELD)
        warnings = [issue for issue in _issues(LlmRerankNode, node) if issue.startswith("warning")]
        assert len(warnings) == 1
        assert "{{items}}" in warnings[0]

    def test_reranker_using_the_item_list_is_clean(self) -> None:
        node = _node("llm.rerank", "Rank {{items}} for {{query}}.", output_fields=SCORE_FIELD)
        assert _issues(LlmRerankNode, node) == []

    @pytest.mark.parametrize("template", ["{{ text }}", "Prefix {{text}} suffix"])
    def test_whitespace_and_surrounding_text_still_count(self, template: str) -> None:
        node = _node("llm.generate", template, output_fields=ITEMS_FIELD)
        assert _issues(LlmGenerateNode, node) == []

    def test_an_unknown_variable_reports_only_its_own_error(self) -> None:
        # The payload check must not pile a second finding onto a template
        # whose placeholders could not be resolved in the first place.
        node = _node("llm.generate", "Rewrite {{banana}}", output_fields=ITEMS_FIELD)
        issues = _issues(LlmGenerateNode, node)
        assert [issue for issue in issues if issue.startswith("warning")] == []
        assert any("banana" in issue for issue in issues)

    def test_something_that_only_looks_like_a_variable_still_warns(self) -> None:
        # `{{ not a name }}` is literal text, so the model really does see an
        # identical prompt for every item — exactly what this warning is for.
        node = _node("llm.generate", "Rewrite {{ not a name }}", output_fields=ITEMS_FIELD)
        warnings = [issue for issue in _issues(LlmGenerateNode, node) if issue.startswith("warning")]
        assert len(warnings) == 1


class TestNodeNaming:
    """Findings name the node the way the canvas does."""

    def test_findings_name_the_editor_label_not_the_node_id(self) -> None:
        node = PipelineNodeDefinition(
            id="llm-7f3a",
            type="llm.generate",
            name="Query expander",
            config={"prompt": "Rewrite {{text}}", "output_fields": ITEMS_FIELD},
        )
        issues = _issues(LlmGenerateNode, node)
        assert issues
        assert all("Query expander" in issue for issue in issues)
        assert not any("llm-7f3a" in issue for issue in issues)

    def test_an_unnamed_node_falls_back_to_its_type(self) -> None:
        node = PipelineNodeDefinition(
            id="llm-7f3a",
            type="llm.generate",
            name="",
            config={"prompt": "Rewrite {{text}}", "output_fields": ITEMS_FIELD},
        )
        assert all("llm.generate" in issue for issue in _issues(LlmGenerateNode, node))
