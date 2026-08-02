"""Validation of `$expr` values on node config fields.

Three checks live here because they share one walk of a node's config: the
expression's own syntax and type, the `self.<field>` sibling scope (its types,
its cycles), and the identity-field taint rule — which must follow taint
*along* sibling chains, since a field reading a request-dependent sibling is
just as request-dependent as one reading the argument directly.
"""

from __future__ import annotations

from app.pipelines.config_fields import expected_expr_type, field_schema, is_static_only
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.expressions import (
    ExpressionError,
    ExprType,
    check_type,
    is_assignable,
    parse,
    references,
    self_references,
)
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.node_scope import ConfigCycleError, resolution_order, self_dependencies
from app.pipelines.registry import NodeRegistry
from app.pipelines.variables import expression_source


def self_types_for(schema: dict[str, object]) -> dict[str, ExprType]:
    """Type every config field of a node, for `self.<field>` references."""
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return {}
    typed: dict[str, ExprType] = {}
    for key in properties:
        expr_type = expected_expr_type(field_schema(schema, key))
        if expr_type is not None:
            typed[key] = expr_type
    return typed


def tainted_config_fields(node: PipelineNodeDefinition, tainted: frozenset[str]) -> frozenset[str]:
    """Return the node's config fields that depend on caller input.

    Taint travels along `self.` chains: a field reading a sibling that reads an
    input argument is exactly as request-dependent as reading the argument
    directly. Without this an identity field could launder taint through one
    hop and get a per-request index name — which returns nothing rather than
    failing, so nothing would ever surface it.
    """
    direct: dict[str, frozenset[str]] = {}
    dirty: set[str] = set()
    for key, value in node.config.items():
        source = expression_source(value)
        if source is None:
            direct[key] = frozenset()
            continue
        try:
            expression = parse(source)
        except ExpressionError:
            direct[key] = frozenset()
            continue
        direct[key] = self_references(expression)
        if references(expression) & tainted:
            dirty.add(key)
    # Propagate to a fixed point: chains are short, and iterating is clearer
    # than a second topological walk that would duplicate node_scope's.
    changed = True
    while changed:
        changed = False
        for key, siblings in direct.items():
            if key not in dirty and siblings & dirty:
                dirty.add(key)
                changed = True
    return frozenset(dirty)


def node_config_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    types: dict[str, ExprType],
    tainted: frozenset[str],
) -> list[PipelineValidationIssue]:
    """Check every `$expr` config value: syntax, typing, cycles, and taint."""
    issues: list[PipelineValidationIssue] = []
    for node in definition.nodes:
        spec = registry.get_spec(node.type)
        schema = spec.config_schema if spec else {}
        self_types = self_types_for(schema)
        tainted_fields = tainted_config_fields(node, tainted)
        try:
            resolution_order(self_dependencies(node.config))
        except ConfigCycleError as cycle:
            issues.extend(
                PipelineValidationIssue(
                    code="expression_cycle",
                    message=(
                        f"Node '{node.id}' field '{field}' is part of a loop "
                        f"between {', '.join(cycle.fields)}, which has no value."
                    ),
                    node_id=node.id,
                    field=field,
                )
                for field in cycle.fields
            )
            continue
        for key, value in node.config.items():
            source = expression_source(value)
            if source is None:
                continue
            issues.extend(
                _config_expression_issues(
                    node, key, source, schema, types, tainted, self_types, tainted_fields
                )
            )
    return issues


def _config_expression_issues(  # noqa: PLR0913 - one check, all its inputs
    node: PipelineNodeDefinition,
    key: str,
    source: str,
    schema: dict[str, object],
    types: dict[str, ExprType],
    tainted: frozenset[str],
    self_types: dict[str, ExprType],
    tainted_fields: frozenset[str],
) -> list[PipelineValidationIssue]:
    """Validate a single config-field expression."""
    try:
        expression = parse(source)
        result = check_type(expression, types, self_types)
    except ExpressionError as error:
        return [
            PipelineValidationIssue(
                code="expression_invalid",
                message=f"Node '{node.id}' field '{key}': {error.message}.",
                node_id=node.id,
                field=key,
            )
        ]
    issues: list[PipelineValidationIssue] = []
    resolved_field = field_schema(schema, key)
    expected = expected_expr_type(resolved_field)
    # An integer config field also takes a number: resolution rounds it, so
    # rejecting `self.chunk_size * 0.2` here would outlaw the natural way to
    # write a share of a token count.
    rounds = expected is ExprType.INTEGER and result is ExprType.NUMBER
    if expected is not None and not rounds and not is_assignable(result, expected):
        issues.append(
            PipelineValidationIssue(
                code="expression_type",
                message=(
                    f"Node '{node.id}' field '{key}' expects {expected} "
                    f"but the expression evaluates to {result}."
                ),
                node_id=node.id,
                field=key,
            )
        )
    # A sibling that is itself request-dependent taints this field too.
    dirty = (references(expression) & tainted) | {
        f"self.{name}" for name in self_references(expression) & tainted_fields
    }
    if is_static_only(resolved_field) and dirty:
        names = ", ".join(sorted(dirty))
        issues.append(
            PipelineValidationIssue(
                code="expression_static_only",
                message=(
                    f"Node '{node.id}' field '{key}' identifies infrastructure and "
                    f"cannot depend on caller input (via: {names}). Use constants "
                    "or variables derived from constants."
                ),
                node_id=node.id,
                field=key,
            )
        )
    return issues
