"""Static validation shared by the LLM node shells.

Each shell declares which write targets and prompt placeholders it allows;
this module turns those declarations plus a node's config into structured
issues, so the three shells don't each re-implement the checks.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from pydantic import ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.prompts import referenced_placeholders
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.ports import Facet
from app.prompting import PromptTemplateError
from app.schemas.enums import PromptContext

#: Write targets each shell allows — declared once, read by the node
#: shells' `ShellRules` and, via `CONTEXT_TARGETS`, by the prompt library's
#: version-level output-field validation, so the two can't drift.
TRANSFORM_TARGETS = frozenset({"metadata", "text"})
RERANK_TARGETS = frozenset({"score", "metadata"})
GENERATE_TARGETS = frozenset({"items"})

CONTEXT_TARGETS: dict[PromptContext, frozenset[str]] = {
    PromptContext.NODE_TRANSFORM: TRANSFORM_TARGETS,
    PromptContext.NODE_RERANK: RERANK_TARGETS,
    PromptContext.NODE_GENERATE: GENERATE_TARGETS,
}


#: What a shell destroys when its output fields rewrite an item's text.
#: The embedding and any arriving score were computed from the text the
#: write replaced, so they describe content the stream no longer carries.
TEXT_WRITE_REMOVES: tuple[str, ...] = (Facet.EMBEDDING, Facet.SCORE)


def removes_from_text_writes(config: dict[str, object]) -> dict[str, tuple[str, ...]]:
    """Return the items port's `removes` for a text-writing shell's config.

    A config the shell's own model rejects removes nothing: the node will
    not run at all, and its own validation reports why. Guessing at a
    broken config here would put a facet error on the graph in front of
    the message that explains the real problem.
    """
    try:
        fields = LlmNodeConfig.model_validate(config).output_fields
    except ValidationError:
        return {}
    writes_text = any(field.target.kind == "text" for field in fields)
    return {"items": TEXT_WRITE_REMOVES} if writes_text else {}


@dataclass(frozen=True)
class ShellRules:
    """What one LLM node shell allows its config to declare."""

    node_label: str
    allowed_targets: frozenset[str]
    allowed_placeholders: frozenset[str]
    #: Placeholders that carry the per-item payload. A template referencing
    #: none of them sends an identical prompt for every item, so the node
    #: does real work and returns one answer copied across the whole stream.
    payload_placeholders: frozenset[str] = frozenset({"text"})
    #: Exactly one `items`-target field required (the generate shell).
    requires_items_field: bool = False
    #: The node attaches the item's own media to every call, so a template
    #: referencing no per-item variable still asks a different question of
    #: each item — the payload is the image, not the prompt text.
    carries_media: bool = False


def _error(
    node: PipelineNodeDefinition, message: str, field: str | None = None
) -> PipelineValidationIssue:
    return PipelineValidationIssue(message=message, severity="error", node_id=node.id, field=field)


def shell_issues(
    node: PipelineNodeDefinition,
    definition: PipelineDefinition,
    config: LlmNodeConfig,
    rules: ShellRules,
) -> list[PipelineValidationIssue]:
    """Return every static issue for one LLM node's config."""
    issues: list[PipelineValidationIssue] = []
    label = rules.node_label
    if config.connection_id is None:
        issues.append(
            _error(
                node,
                f"{label} node '{node.display_name}' has no provider connection configured. "
                "Pick one in the pipeline editor.",
                field="connection_id",
            )
        )
    if not config.model_name:
        issues.append(
            _error(
                node,
                f"{label} node '{node.display_name}' has no model configured. "
                "Pick one in the pipeline editor.",
                field="model_name",
            )
        )
    if not config.prompt.strip():
        issues.append(
            _error(node, f"{label} node '{node.display_name}' has an empty prompt.", field="prompt")
        )
    issues.extend(_field_issues(node, config, rules))
    issues.extend(_placeholder_issues(node, definition, config, rules))
    issues.extend(_payload_issues(node, config, rules))
    return issues


def _payload_issues(
    node: PipelineNodeDefinition, config: LlmNodeConfig, rules: ShellRules
) -> list[PipelineValidationIssue]:
    """Warn when nothing item-specific reaches the model.

    A template with no payload placeholder renders to the same string for
    every item, so the node spends a model call each and writes one answer
    across the whole stream — valid, expensive, and almost never intended.
    """
    referenced: set[str] = set()
    for template in (config.system_prompt, config.prompt):
        try:
            referenced |= set(referenced_placeholders(template))
        except PromptTemplateError:
            # Already reported as an error by `_placeholder_issues`.
            return []
    if rules.carries_media:
        return []
    if any(
        name in rules.payload_placeholders or name.startswith("metadata.") for name in referenced
    ):
        return []
    expected = ", ".join(f"{{{{{name}}}}}" for name in sorted(rules.payload_placeholders))
    return [
        PipelineValidationIssue(
            message=(
                f"{rules.node_label} node '{node.display_name}' references nothing from the item it "
                f"processes, so every item gets the same prompt and the same answer. "
                f"Add {expected}."
            ),
            severity="warning",
            node_id=node.id,
            field="prompt",
        )
    ]


def _field_issues(
    node: PipelineNodeDefinition, config: LlmNodeConfig, rules: ShellRules
) -> list[PipelineValidationIssue]:
    issues: list[PipelineValidationIssue] = []
    label = rules.node_label
    if not config.output_fields:
        issues.append(
            _error(
                node,
                f"{label} node '{node.display_name}' declares no output fields — the model "
                "would have nothing to return.",
                field="output_fields",
            )
        )
        return issues
    duplicates = [
        name
        for name, count in Counter(spec.name for spec in config.output_fields).items()
        if count > 1
    ]
    issues.extend(
        _error(
            node,
            f"{label} node '{node.display_name}' declares output field '{name}' more than once.",
            field="output_fields",
        )
        for name in duplicates
    )
    for spec in config.output_fields:
        if spec.target.kind not in rules.allowed_targets:
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.display_name}' field '{spec.name}' targets "
                    f"'{spec.target.kind}', which this node type cannot write.",
                    field="output_fields",
                )
            )
        if spec.target.kind == "items" and spec.type != "string_list":
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.display_name}' field '{spec.name}' must be a string "
                    "list to emit items.",
                    field="output_fields",
                )
            )
    items_fields = [spec for spec in config.output_fields if spec.target.kind == "items"]
    if rules.requires_items_field and len(items_fields) != 1:
        issues.append(
            _error(
                node,
                f"{label} node '{node.display_name}' needs exactly one output field targeting "
                "'items' — that list is what becomes the generated items.",
                field="output_fields",
            )
        )
    score_fields = [spec for spec in config.output_fields if spec.target.kind == "score"]
    if len(score_fields) > 1:
        issues.append(
            _error(
                node,
                f"{label} node '{node.display_name}' declares more than one score field; "
                "an item has one score.",
                field="output_fields",
            )
        )
    return issues


def _placeholder_issues(
    node: PipelineNodeDefinition,
    definition: PipelineDefinition,
    config: LlmNodeConfig,
    rules: ShellRules,
) -> list[PipelineValidationIssue]:
    issues: list[PipelineValidationIssue] = []
    label = rules.node_label
    for field_name, template in (
        ("system_prompt", config.system_prompt),
        ("prompt", config.prompt),
    ):
        try:
            names = referenced_placeholders(template)
        except PromptTemplateError as exc:
            issues.append(_error(node, f"{label} node '{node.display_name}': {exc}", field=field_name))
            continue
        for name in names:
            if name.startswith("metadata."):
                continue
            if name not in rules.allowed_placeholders:
                issues.append(
                    _error(
                        node,
                        f"{label} node '{node.display_name}' uses '{{{{{name}}}}}', which this "
                        "node type cannot provide.",
                        field=field_name,
                    )
                )
        if "document_text" in names and not _document_port_wired(node, definition):
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.display_name}' uses '{{{{document_text}}}}' but nothing "
                    "is wired into its document input. Connect the parser to it.",
                    field=field_name,
                )
            )
    return issues


def _document_port_wired(node: PipelineNodeDefinition, definition: PipelineDefinition) -> bool:
    return any(
        edge.target == node.id and edge.target_port == "document" for edge in definition.edges
    )
