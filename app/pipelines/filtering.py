"""Metadata-filter resolution and validation for retriever nodes.

Filter values may name a pipeline variable (`var`) so a tool argument
becomes a filter at call time; resolution happens here, against the run's
evaluated variable environment, so the vector stores only ever see literal
values. Static validation checks condition coherence, variable existence,
and whether the node's backend can filter at all.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.variables import COLLECTION_VARIABLES, QUERY_VARIABLE
from app.schemas.enums import IndexBackend
from app.schemas.metadata_filter import (
    FilterCondition,
    MetadataFilter,
    condition_problems,
)
from app.services.errors import InvalidInputError
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND


def resolve_filter(
    metadata_filter: MetadataFilter | None,
    context: PipelineRunContext,
    *,
    node_label: str,
) -> MetadataFilter | None:
    """Return the filter with every `var` reference replaced by its value.

    Raises `InvalidInputError` for incoherent conditions or unknown/
    non-scalar variables — a filter that cannot be evaluated must not
    silently widen into no filter.
    """
    if metadata_filter is None or metadata_filter.is_empty():
        return None
    resolved: list[FilterCondition] = []
    for condition in metadata_filter.all:
        problems = condition_problems(condition)
        if problems:
            raise InvalidInputError(
                f"{node_label}: metadata filter on '{condition.field}' {'; '.join(problems)}."
            )
        if condition.var is None:
            resolved.append(condition)
            continue
        value = _variable_value(condition.var, context, node_label)
        resolved.append(condition.model_copy(update={"value": value, "var": None}))
    return MetadataFilter(all=resolved)


def _variable_value(
    name: str, context: PipelineRunContext, node_label: str
) -> bool | int | float | str:
    environment = context.variables
    if environment is None or name not in environment.values:
        raise InvalidInputError(
            f"{node_label}: metadata filter reads variable '{name}', which "
            "this run does not define."
        )
    value = environment.values[name]
    if not isinstance(value, (bool, int, float, str)):
        raise InvalidInputError(
            f"{node_label}: metadata filter variable '{name}' is not a scalar value."
        )
    return value


def filter_issues(
    metadata_filter: MetadataFilter | None,
    node: PipelineNodeDefinition,
    definition: PipelineDefinition,
    backend: IndexBackend | None,
    *,
    node_label: str,
) -> list[PipelineValidationIssue]:
    """Static issues for a retriever node's configured filter."""
    if metadata_filter is None or metadata_filter.is_empty():
        return []
    issues: list[PipelineValidationIssue] = []
    if backend is not None:
        capabilities = CAPABILITIES_BY_BACKEND.get(backend)
        if capabilities is not None and not capabilities.supports_metadata_filter:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"{node_label} node '{node.id}' declares a metadata "
                        f"filter, but the {backend.value} backend cannot filter."
                    ),
                    severity="error",
                    node_id=node.id,
                    field="filter",
                )
            )
    known_variables = {
        QUERY_VARIABLE,
        *COLLECTION_VARIABLES,
        *(variable.name for variable in definition.variables),
    }
    for condition in metadata_filter.all:
        issues.extend(
            PipelineValidationIssue(
                message=(
                    f"{node_label} node '{node.id}' metadata filter on "
                    f"'{condition.field or '?'}' {problem}."
                ),
                severity="error",
                node_id=node.id,
                field="filter",
            )
            for problem in condition_problems(condition)
        )
        if condition.var is not None and condition.var not in known_variables:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"{node_label} node '{node.id}' metadata filter reads "
                        f"variable '{condition.var}', which the pipeline does "
                        "not declare."
                    ),
                    severity="error",
                    node_id=node.id,
                    field="filter",
                )
            )
    return issues
