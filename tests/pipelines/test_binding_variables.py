"""Binding-source variables and the built-in collection descriptors.

These are what make one pipeline serve many collections: a binding variable's
value comes from the `CollectionPipelineBinding`, and the collection built-ins
name the collection the pipeline is bound to. Both must reach node configs
*without* being tainted, or the identity-field rule would reject every index
name derived from them.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.environment import VariableResolutionError, build_environment
from app.pipelines.expressions import ExprType, IndexValue
from app.pipelines.nodes.indexing import VectorIndexerNode
from app.pipelines.registry import default_registry
from app.pipelines.resolution import resolve_definition, resolve_static_definition
from app.pipelines.validation_variables import collect_variable_issues
from app.pipelines.variables import (
    BindingContext,
    CollectionScope,
    PipelineVariable,
    VariableSource,
    VariableType,
)

INDEX_ID = UUID("1f2e3d4c-5b6a-4798-8899-aabbccddeeff")


def _index_variable(name: str = "primary_index", **overrides: object) -> PipelineVariable:
    """Declare a binding-source index variable with a default index."""
    payload: dict[str, object] = {
        "name": name,
        "type": VariableType.INDEX,
        "source": VariableSource.BINDING,
        "value": {"index_id": str(INDEX_ID), "backend": "pgvector", "name": "docs-main"},
    }
    payload.update(overrides)
    return PipelineVariable.model_validate(payload)


def _indexer_definition(variables: list[PipelineVariable]) -> PipelineDefinition:
    """An indexer whose identity fields read from an index variable."""
    node = PipelineNodeDefinition(
        id="indexer",
        type=VectorIndexerNode.type,
        name="Indexer",
        config={
            "backend": {"$expr": "primary_index.backend"},
            "index_name": {"$expr": "primary_index.name"},
        },
    )
    return PipelineDefinition(nodes=[node], variables=variables)


class TestBindingValues:
    """A binding's overrides replace the declared defaults."""

    def test_default_applies_without_an_override(self) -> None:
        env = build_environment(_indexer_definition([_index_variable()]))
        assert env.values["primary_index"] == IndexValue(
            index_id=INDEX_ID, backend="pgvector", name="docs-main"
        )

    def test_binding_override_replaces_the_default(self) -> None:
        other = uuid4()
        env = build_environment(
            _indexer_definition([_index_variable()]),
            binding=BindingContext(
                collection=CollectionScope.placeholder(),
                values={
                    "primary_index": {
                        "index_id": str(other),
                        "backend": "pinecone",
                        "name": "shared-corpus",
                    }
                },
            ),
        )
        assert env.values["primary_index"] == IndexValue(
            index_id=other, backend="pinecone", name="shared-corpus"
        )

    def test_binding_values_are_not_tainted(self) -> None:
        """The taint rule must not reject identity fields fed by a binding."""
        env = build_environment(_indexer_definition([_index_variable()]))
        assert "primary_index" not in env.tainted

    def test_two_bindings_resolve_the_same_definition_to_different_indexes(self) -> None:
        definition = _indexer_definition([_index_variable()])
        first = resolve_static_definition(definition)
        second = resolve_static_definition(
            definition,
            binding=BindingContext(
                collection=CollectionScope.placeholder(),
                values={
                    "primary_index": {
                        "index_id": str(uuid4()),
                        "backend": "pinecone",
                        "name": "tenant-b",
                    }
                },
            ),
        )
        assert first.node_map()["indexer"].config["index_name"] == "docs-main"
        assert first.node_map()["indexer"].config["backend"] == "pgvector"
        assert second.node_map()["indexer"].config["index_name"] == "tenant-b"
        assert second.node_map()["indexer"].config["backend"] == "pinecone"

    def test_missing_value_and_default_is_reported(self) -> None:
        definition = _indexer_definition([_index_variable(value=None)])
        with pytest.raises(VariableResolutionError, match="must be set for this collection"):
            build_environment(definition)

    def test_unknown_binding_variable_is_rejected(self) -> None:
        with pytest.raises(VariableResolutionError, match="Unknown binding variable 'nope'"):
            build_environment(
                _indexer_definition([_index_variable()]),
                binding=BindingContext(
                    collection=CollectionScope.placeholder(), values={"nope": 1}
                ),
            )

    def test_malformed_override_is_rejected(self) -> None:
        with pytest.raises(VariableResolutionError, match="expected an index value"):
            build_environment(
                _indexer_definition([_index_variable()]),
                binding=BindingContext(
                    collection=CollectionScope.placeholder(),
                    values={"primary_index": {"name": "no-backend"}},
                ),
            )

    def test_bare_index_variable_in_config_is_rejected(self) -> None:
        node = PipelineNodeDefinition(
            id="indexer",
            type=VectorIndexerNode.type,
            name="Indexer",
            config={"index_name": {"$expr": "primary_index"}},
        )
        definition = PipelineDefinition(nodes=[node], variables=[_index_variable()])
        env = build_environment(definition)
        with pytest.raises(VariableResolutionError, match=r"dereferenced with \.backend"):
            resolve_definition(definition, env)


class TestCollectionBuiltins:
    """`collection_id`/`collection_name`/`user_id` are ordinary variables."""

    def test_builtins_are_present_and_untainted(self) -> None:
        env = build_environment(PipelineDefinition(nodes=[]))
        for name in ("collection_id", "collection_name", "user_id"):
            assert env.types[name] is ExprType.STRING
            assert name not in env.tainted

    def test_index_name_derived_from_the_collection(self) -> None:
        collection_id = uuid4()
        node = PipelineNodeDefinition(
            id="indexer",
            type=VectorIndexerNode.type,
            name="Indexer",
            config={"namespace": {"$expr": "'col-' + collection_id"}},
        )
        resolved = resolve_static_definition(
            PipelineDefinition(nodes=[node]),
            binding=BindingContext(
                collection=CollectionScope(
                    collection_id=str(collection_id),
                    collection_name="Docs",
                    user_id=str(uuid4()),
                )
            ),
        )
        assert resolved.node_map()["indexer"].config["namespace"] == f"col-{collection_id}"

    def test_builtins_resolve_empty_without_a_collection(self) -> None:
        """Editor validation has no collection, so expressions still type-check."""
        node = PipelineNodeDefinition(
            id="indexer",
            type=VectorIndexerNode.type,
            name="Indexer",
            config={"namespace": {"$expr": "'col-' + collection_id"}},
        )
        resolved = resolve_static_definition(PipelineDefinition(nodes=[node]))
        assert resolved.node_map()["indexer"].config["namespace"] == "col-"


class TestBindingVariableValidation:
    """Declaration rules specific to the binding source and index type."""

    def test_identity_field_fed_by_a_binding_variable_is_allowed(self) -> None:
        issues = collect_variable_issues(
            _indexer_definition([_index_variable()]), default_registry()
        )
        assert [issue.code for issue in issues if issue.code == "expression_static_only"] == []

    def test_caller_supplied_index_is_rejected(self) -> None:
        definition = _indexer_definition(
            [_index_variable(source=VariableSource.INPUT, value=None)]
        )
        issues = collect_variable_issues(definition, default_registry())
        assert any("cannot be caller-supplied" in issue.message for issue in issues)

    def test_binding_variable_with_an_expression_is_rejected(self) -> None:
        definition = _indexer_definition(
            [
                PipelineVariable(
                    name="primary_index",
                    type=VariableType.STRING,
                    source=VariableSource.BINDING,
                    expression="'x'",
                )
            ]
        )
        issues = collect_variable_issues(definition, default_registry())
        assert any("not an expression" in issue.message for issue in issues)

    def test_collection_builtin_name_is_reserved(self) -> None:
        definition = PipelineDefinition(
            nodes=[],
            variables=[
                PipelineVariable(name="collection_id", type=VariableType.STRING, value="x")
            ],
        )
        issues = collect_variable_issues(definition, default_registry())
        assert any("is reserved" in issue.message for issue in issues)
