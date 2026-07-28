"""Definition resolution: replace every `$expr` config value with a literal.

The engine never executes expressions mid-run. `resolve_definition` walks a
definition against an already-built `VariableEnvironment`
(`app/pipelines/environment.py`) and returns a copy whose node configs hold
only literals, so everything downstream (executor, `NodeRegistry.create`,
settings resolution, traces) sees plain values.

`resolve_static_definition` is the view every *static* consumer reads
(settings resolution, validation hooks, tokenizer prefetch). Passing a
collection scope and the binding's variable values makes that view per
binding: the same stored definition resolves to whichever index that
collection selected.
"""

from __future__ import annotations

from app.pipelines.definition import PipelineDefinition
from app.pipelines.environment import (
    VariableResolutionError,
    build_environment,
)
from app.pipelines.expressions import (
    ExpressionError,
    ExprValue,
    IndexValue,
    ModelValue,
    evaluate,
    parse,
)
from app.pipelines.node_scope import (
    ConfigCycleError,
    resolution_order,
    self_dependencies,
)
from app.pipelines.variables import (
    BindingContext,
    VariableEnvironment,
    expression_source,
)


def _node_defaults(node_type: str) -> dict[str, object]:
    """Return a node type's config defaults, or nothing for an unknown type.

    Imported lazily: the registry constructs every node class, and resolution
    is imported by modules the registry itself reaches.
    """
    from app.pipelines.registry import default_registry

    spec = default_registry().get_spec(node_type)
    return dict(spec.default_config) if spec is not None else {}


def default_environment(
    definition: PipelineDefinition,
    *,
    binding: BindingContext | None = None,
) -> VariableEnvironment:
    """Build the static environment (argument defaults/placeholders)."""
    return build_environment(definition, static_defaults=True, binding=binding)


def resolve_static_definition(
    definition: PipelineDefinition,
    *,
    binding: BindingContext | None = None,
) -> PipelineDefinition:
    """Resolve expressions against the static default environment.

    The literal-config view every static consumer (settings resolution,
    validation hooks, tokenizer prefetch) reads. When the environment itself
    is broken, expressions are stripped instead — the validator reports the
    underlying problem; static consumers just need configs their models can
    parse.

    `binding` is what makes this view *per binding*: the same definition
    resolves to whichever index that collection's binding selected, which is
    what purge coverage and diagnostics read.
    """
    try:
        return resolve_definition(
            definition, default_environment(definition, binding=binding)
        )
    except VariableResolutionError:
        return strip_expressions(definition)


def resolve_definition(
    definition: PipelineDefinition,
    environment: VariableEnvironment,
) -> PipelineDefinition:
    """Return a copy of the definition with every `$expr` config value evaluated.

    A bare structured result is rejected — config fields take scalars, so
    model variables are always dereferenced (`.connection_id`/`.model_name`)
    and index variables likewise (`.backend`/`.name`).
    """
    errors: list[str] = []
    nodes = []
    for node in definition.nodes:
        config = dict(node.config)
        changed = False
        try:
            order = resolution_order(self_dependencies(config))
        except ConfigCycleError as cycle:
            errors.append(f"Node '{node.id}': {cycle}")
            nodes.append(node)
            continue
        # Siblings already reduced to literals, so `self.<field>` always reads
        # a value rather than another expression. Seeded with the node's config
        # defaults: a field the author never set still has the value the node
        # will run with, so reading it is not a run-time "no such field".
        resolved: dict[str, ExprValue] = {
            key: value
            for key, value in {**_node_defaults(node.type), **config}.items()
            if expression_source(value) is None and isinstance(value, (int, float, str, bool))
        }
        for key in order:
            value = config[key]
            source = expression_source(value)
            if source is None:
                continue
            try:
                result = evaluate(parse(source), environment.values, resolved)
            except ExpressionError as error:
                errors.append(f"Node '{node.id}' field '{key}': {error.message}")
                continue
            if isinstance(result, ModelValue):
                errors.append(
                    f"Node '{node.id}' field '{key}': a model variable must be "
                    "dereferenced with .connection_id or .model_name."
                )
                continue
            if isinstance(result, IndexValue):
                errors.append(
                    f"Node '{node.id}' field '{key}': an index variable must be "
                    "dereferenced with .backend or .name."
                )
                continue
            config[key] = result
            resolved[key] = result
            changed = True
        nodes.append(node.model_copy(update={"config": config}) if changed else node)
    if errors:
        raise VariableResolutionError(errors)
    return definition.model_copy(update={"nodes": nodes})


def strip_expressions(definition: PipelineDefinition) -> PipelineDefinition:
    """Return a copy with every `$expr` config value removed.

    The validator's fallback when the environment itself is broken: per-node
    validation hooks then check the remaining literal fields against the
    config model's defaults instead of crashing on `{"$expr": ...}` dicts.
    """
    nodes = []
    for node in definition.nodes:
        expression_keys = [key for key, value in node.config.items() if expression_source(value)]
        if not expression_keys:
            nodes.append(node)
            continue
        config = {key: value for key, value in node.config.items() if key not in expression_keys}
        nodes.append(node.model_copy(update={"config": config}))
    return definition.model_copy(update={"nodes": nodes})
