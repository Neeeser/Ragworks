"""Helpers for the one-way ``top_k`` to ``result_limit`` vocabulary upgrade."""

from __future__ import annotations

from app.pipelines.defaults import DEFAULT_RESULT_LIMIT_VARIABLE
from app.pipelines.definition import PipelineNodeDefinition
from app.pipelines.expressions.errors import ExpressionSyntaxError
from app.pipelines.expressions.parser import TokenKind, tokenize
from app.pipelines.variables import PipelineVariable

RETRIEVAL_INPUT_TYPE = "retrieval.input"


def migrated_limit_name(name: str) -> str:
    """Rename the caller-facing depth argument to the result-limit name."""
    return DEFAULT_RESULT_LIMIT_VARIABLE.name if name == "top_k" else name


def migrate_input_argument_names(node: PipelineNodeDefinition) -> PipelineNodeDefinition:
    """Rename transitional v2 input argument names without changing their shape."""
    if node.type != RETRIEVAL_INPUT_TYPE:
        return node
    arguments = node.config.get("arguments")
    if not isinstance(arguments, list):
        return node
    migrated = [
        migrated_limit_name(argument) if isinstance(argument, str) else argument
        for argument in arguments
    ]
    return node.model_copy(update={"config": {**node.config, "arguments": migrated}})


def migrate_variable(variable: PipelineVariable) -> PipelineVariable:
    """Rename a declaration and any derived expression that references it."""
    expression = (
        rename_top_k_identifier(variable.expression) if variable.expression is not None else None
    )
    return variable.model_copy(
        deep=True,
        update={"name": migrated_limit_name(variable.name), "expression": expression},
    )


def migrate_node_expressions(node: PipelineNodeDefinition) -> PipelineNodeDefinition:
    """Rename references to the migrated caller argument in every node config."""
    config = {key: migrate_top_k_expression(value) for key, value in node.config.items()}
    outputs = config.get("outputs")
    if node.type == "retrieval.output" and isinstance(outputs, list):
        config["outputs"] = [
            {**output, "expression": rename_top_k_identifier(output["expression"])}
            if isinstance(output, dict) and isinstance(output.get("expression"), str)
            else output
            for output in outputs
        ]
    return node.model_copy(update={"config": config})


def migrate_top_k_expression(value: object) -> object:
    """Rename ``top_k`` identifier tokens inside a tagged expression."""
    if not isinstance(value, dict) or set(value) != {"$expr"}:
        return value
    source = value.get("$expr")
    if not isinstance(source, str):
        return value
    return {"$expr": rename_top_k_identifier(source)}


def rename_top_k_identifier(source: str) -> str:
    """Rename identifier tokens without changing string literals or partial names."""
    try:
        replacements = [
            token
            for token in tokenize(source)
            if token.kind is TokenKind.IDENT and token.text == "top_k"
        ]
    except ExpressionSyntaxError:
        return source
    for token in reversed(replacements):
        source = (
            source[: token.position]
            + DEFAULT_RESULT_LIMIT_VARIABLE.name
            + source[token.position + len(token.text) :]
        )
    return source
