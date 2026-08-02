"""Static validation shared by the LLM node shells.

Each shell declares which write targets and prompt placeholders it allows;
this module turns those declarations plus a node's config into structured
issues, so the three shells don't each re-implement the checks.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.prompts import PromptTemplateError, referenced_placeholders
from app.pipelines.node import PipelineValidationIssue


@dataclass(frozen=True)
class ShellRules:
    """What one LLM node shell allows its config to declare."""

    node_label: str
    allowed_targets: frozenset[str]
    allowed_placeholders: frozenset[str]
    #: Exactly one `items`-target field required (the generate shell).
    requires_items_field: bool = False


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
                f"{label} node '{node.id}' has no provider connection configured. "
                "Pick one in the pipeline editor.",
                field="connection_id",
            )
        )
    if not config.model_name:
        issues.append(
            _error(
                node,
                f"{label} node '{node.id}' has no model configured. "
                "Pick one in the pipeline editor.",
                field="model_name",
            )
        )
    if not config.prompt.strip():
        issues.append(
            _error(node, f"{label} node '{node.id}' has an empty prompt.", field="prompt")
        )
    issues.extend(_field_issues(node, config, rules))
    issues.extend(_placeholder_issues(node, definition, config, rules))
    return issues


def _field_issues(
    node: PipelineNodeDefinition, config: LlmNodeConfig, rules: ShellRules
) -> list[PipelineValidationIssue]:
    issues: list[PipelineValidationIssue] = []
    label = rules.node_label
    if not config.output_fields:
        issues.append(
            _error(
                node,
                f"{label} node '{node.id}' declares no output fields — the model "
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
            f"{label} node '{node.id}' declares output field '{name}' more than once.",
            field="output_fields",
        )
        for name in duplicates
    )
    for spec in config.output_fields:
        if spec.target.kind not in rules.allowed_targets:
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.id}' field '{spec.name}' targets "
                    f"'{spec.target.kind}', which this node type cannot write.",
                    field="output_fields",
                )
            )
        if spec.target.kind == "items" and spec.type != "string_list":
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.id}' field '{spec.name}' must be a string "
                    "list to emit items.",
                    field="output_fields",
                )
            )
    items_fields = [spec for spec in config.output_fields if spec.target.kind == "items"]
    if rules.requires_items_field and len(items_fields) != 1:
        issues.append(
            _error(
                node,
                f"{label} node '{node.id}' needs exactly one output field targeting "
                "'items' — that list is what becomes the generated items.",
                field="output_fields",
            )
        )
    score_fields = [spec for spec in config.output_fields if spec.target.kind == "score"]
    if len(score_fields) > 1:
        issues.append(
            _error(
                node,
                f"{label} node '{node.id}' declares more than one score field; "
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
            issues.append(_error(node, f"{label} node '{node.id}': {exc}", field=field_name))
            continue
        for name in names:
            if name.startswith("metadata."):
                continue
            if name not in rules.allowed_placeholders:
                issues.append(
                    _error(
                        node,
                        f"{label} node '{node.id}' uses '{{{name}}}', which this "
                        "node type cannot provide.",
                        field=field_name,
                    )
                )
        if "document_text" in names and not _document_port_wired(node, definition):
            issues.append(
                _error(
                    node,
                    f"{label} node '{node.id}' uses '{{document_text}}' but nothing "
                    "is wired into its document input. Connect the parser to it.",
                    field=field_name,
                )
            )
    return issues


def _document_port_wired(node: PipelineNodeDefinition, definition: PipelineDefinition) -> bool:
    return any(
        edge.target == node.id and edge.target_port == "document" for edge in definition.edges
    )
