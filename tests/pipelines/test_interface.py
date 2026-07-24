"""Derived pipeline interfaces: what a graph can do, read off its boundary nodes.

The interface is the single source of truth for binding fitness (can this
pipeline serve as a collection's ingest binding? be exposed as a tool?) and
for the tool projection chat/MCP render (name, description, argument schema,
output kind). It is derived from the definition, never author-declared.
"""

from __future__ import annotations

from uuid import uuid4

from app.pipelines.defaults import (
    build_default_ingestion_pipeline,
    build_default_retrieval_pipeline,
)
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.interface import PipelineInterface, ToolOutputKind, derive_interface
from app.pipelines.nodes.io import RetrievalInputNode
from app.pipelines.variables import PipelineVariable, VariableSource, VariableType

EMBEDDING = (uuid4(), "text-embedding-3-small")


def _ingestion_definition() -> PipelineDefinition:
    return build_default_ingestion_pipeline(
        embedding_connection_id=EMBEDDING[0], embedding_model=EMBEDDING[1]
    )


def _retrieval_definition() -> PipelineDefinition:
    return build_default_retrieval_pipeline(
        embedding_connection_id=EMBEDDING[0], embedding_model=EMBEDDING[1]
    )


class TestDeriveInterface:
    """`derive_interface` reads capability off the graph's boundary nodes."""

    def test_ingestion_definition_accepts_documents_and_is_not_callable(self) -> None:
        interface = derive_interface(_ingestion_definition())
        assert interface.accepts_document is True
        assert interface.callable is False
        assert interface.output_kind is None
        assert interface.tool_name is None

    def test_retrieval_definition_is_callable_with_chunk_output(self) -> None:
        interface = derive_interface(_retrieval_definition())
        assert interface.accepts_document is False
        assert interface.callable is True
        assert interface.output_kind is ToolOutputKind.CHUNKS

    def test_tool_identity_reads_off_the_input_node_config(self) -> None:
        definition = _retrieval_definition()
        for node in definition.nodes:
            if node.type == RetrievalInputNode.type:
                node.config = {
                    **node.config,
                    "tool_name": "facet_count",
                    "tool_description": "Count matching documents by field.",
                }
        interface = derive_interface(definition)
        assert interface.tool_name == "facet_count"
        assert interface.tool_description == "Count matching documents by field."

    def test_declared_arguments_project_onto_the_interface(self) -> None:
        definition = _retrieval_definition()
        definition.variables.append(
            PipelineVariable(
                name="result_limit",
                type=VariableType.INTEGER,
                source=VariableSource.INPUT,
                minimum=1,
                maximum=50,
                value=5,
            )
        )
        for node in definition.nodes:
            if node.type == RetrievalInputNode.type:
                node.config = {**node.config, "arguments": ["result_limit"]}
        interface = derive_interface(definition)
        assert [argument.name for argument in interface.arguments] == ["result_limit"]

    def test_declared_output_fields_project_onto_the_interface(self) -> None:
        definition = _retrieval_definition()
        for node in definition.nodes:
            if node.type == "retrieval.output":
                node.config = {
                    **node.config,
                    "outputs": [{"name": "effective_depth", "expression": "result_limit"}],
                }
        definition.variables.append(
            PipelineVariable(
                name="result_limit",
                type=VariableType.INTEGER,
                source=VariableSource.INPUT,
                value=5,
            )
        )
        interface = derive_interface(definition)
        assert interface.output_fields == ["effective_depth"]

    def test_empty_definition_has_no_capabilities(self) -> None:
        definition = PipelineDefinition(
            nodes=[
                PipelineNodeDefinition(
                    id="chunker",
                    type="chunker.token",
                    name="Chunker",
                    config={},
                )
            ],
            edges=[],
        )
        interface = derive_interface(definition)
        assert interface.accepts_document is False
        assert interface.callable is False
        assert interface.output_kind is None


class TestInterfaceRoundTrip:
    """The interface serializes to/from the JSON stored on a pipeline version."""

    def test_round_trips_through_json(self) -> None:
        interface = derive_interface(_retrieval_definition())
        restored = PipelineInterface.model_validate(interface.model_dump(mode="json"))
        assert restored == interface


class TestDerivationFallbacks:
    """Malformed configs degrade to the neutral projection, never crash."""

    def test_malformed_tool_identity_config_yields_no_identity(self) -> None:
        definition = _retrieval_definition()
        for node in definition.nodes:
            if node.type == RetrievalInputNode.type:
                node.config = {**node.config, "tool_name": ["not", "a", "string"]}
        interface = derive_interface(definition)
        assert interface.tool_name is None
        assert interface.callable is True

    def test_malformed_outputs_config_yields_no_output_fields(self) -> None:
        definition = _retrieval_definition()
        for node in definition.nodes:
            if node.type == "retrieval.output":
                node.config = {**node.config, "outputs": "garbage"}
        interface = derive_interface(definition)
        assert interface.output_fields == []

    def test_tool_output_terminal_derives_structured_kind(self) -> None:
        definition = _retrieval_definition()
        for node in definition.nodes:
            if node.type == "retrieval.output":
                node.type = "tool.output"
        interface = derive_interface(definition)
        assert interface.output_kind is ToolOutputKind.STRUCTURED
