"""Behavioral tests for PipelineValidator and the node spec/registry it relies on."""

from __future__ import annotations

import pytest

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase
from app.pipelines.nodes.embedding import EmbedderNode
from app.pipelines.nodes.indexing import IndexerConfig, IndexerNode
from app.pipelines.nodes.retrieval import PineconeRetrieverNode, RetrievalInputNode, RetrieverConfig
from app.pipelines.ports import NodePort
from app.pipelines.registry import NodeRegistry
from app.pipelines.validation import PipelineValidator


class _InputNode(PipelineNodeBase):
    type = "test.input"
    label = "Input"
    category = "test"
    description = "Input node"
    example = "Input -> Output."
    input_ports = ()
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "payload"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None  # pragma: no cover - this node is used without tracing


class _DoubleInputNode(PipelineNodeBase):
    type = "test.double"
    label = "Double"
    category = "test"
    description = "Double input node"
    example = "A+B -> Output."
    input_ports = (
        NodePort(key="a", label="A", data_type="text"),
        NodePort(key="b", label="B", data_type="text"),
    )
    output_ports = (NodePort(key="out", label="Out", data_type="text"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"out": "ok"}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _NumberSinkNode(PipelineNodeBase):
    type = "test.number"
    label = "Number Sink"
    category = "test"
    description = "Number input node"
    example = "Input -> Output."
    input_ports = (NodePort(key="value", label="Value", data_type="number"),)
    output_ports = ()

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _ChunkSourceNode(PipelineNodeBase):
    type = "test.chunks"
    label = "Chunk Source"
    category = "test"
    description = "Outputs a chunk batch."
    example = "Input -> Chunks."
    input_ports = ()
    output_ports = (NodePort(key="chunks", label="Chunks", data_type="chunk_batch"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"chunks": []}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _EmbeddedSourceNode(PipelineNodeBase):
    type = "test.embedded"
    label = "Embedded Source"
    category = "test"
    description = "Outputs an embedded batch."
    example = "Input -> Embedded."
    input_ports = ()
    output_ports = (NodePort(key="embedded", label="Embedded", data_type="embedded_batch"),)

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        return {"embedded": []}

    def summarize_io(self, inputs: dict[str, object], outputs: dict[str, object]):
        return None


class _BlankSpecNode(PipelineNodeBase):
    type = "test.blank"
    label = "Blank"
    category = "test"
    description = " "
    example = " "
    input_ports = ()
    output_ports = ()


class _MissingExampleNode(PipelineNodeBase):
    type = "test.missing_example"
    label = "Missing"
    category = "test"
    description = "Has description"
    example = ""
    input_ports = ()
    output_ports = ()


class _MissingDescriptionNode(PipelineNodeBase):
    type = "test.missing_desc"
    label = "Missing"
    category = "test"
    description = ""
    example = "Example"
    input_ports = ()
    output_ports = ()


def test_pipeline_node_base_spec_requires_description_and_example() -> None:
    with pytest.raises(ValueError, match="must define a description"):
        _MissingDescriptionNode.spec()
    with pytest.raises(ValueError, match="must define an example"):
        _MissingExampleNode.spec()
    with pytest.raises(ValueError, match="must define a description"):
        _BlankSpecNode.spec()


def test_node_registry_create_unknown_type_raises() -> None:
    registry = NodeRegistry([_InputNode])
    with pytest.raises(ValueError, match="Unknown node type"):
        registry.create(PipelineNodeDefinition(id="x", type="missing", name="Missing"))


def test_pipeline_validator_collects_errors() -> None:
    registry = NodeRegistry([_InputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="dup", type="test.input", name="First"),
            PipelineNodeDefinition(id="dup", type="unknown", name="Second"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge", source="missing", target="also-missing", source_port="out"
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("Duplicate node ids" in error for error in result.errors)
    assert any("Unknown node type" in error for error in result.errors)
    assert any("unknown source" in error for error in result.errors)
    assert any("unknown target" in error for error in result.errors)


def test_pipeline_validator_detects_ports_and_missing_inputs() -> None:
    registry = NodeRegistry([_InputNode, _DoubleInputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="double", type="test.double", name="Double"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="double",
                source_port="missing",
                target_port="a",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("missing output port" in error for error in result.errors)
    assert any("missing inbound edges" in error for error in result.errors)


def test_pipeline_validator_detects_missing_input_port() -> None:
    registry = NodeRegistry([_InputNode, _DoubleInputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="double", type="test.double", name="Double"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="double",
                source_port="out",
                target_port="missing",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("missing input port" in error for error in result.errors)


def test_pipeline_validator_detects_incompatible_port_types() -> None:
    registry = NodeRegistry([_InputNode, _NumberSinkNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="test.input", name="Input"),
            PipelineNodeDefinition(id="number", type="test.number", name="Number"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge",
                source="input",
                target="number",
                source_port="out",
                target_port="value",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("incompatible port types" in error for error in result.errors)


def test_pipeline_validator_reports_dimension_mismatch() -> None:
    registry = NodeRegistry([_ChunkSourceNode, EmbedderNode, IndexerNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.chunks", name="Source"),
            PipelineNodeDefinition(
                id="embedder",
                type="embedder.openrouter",
                name="Embedder",
                config={"dimension": 512},
            ),
            PipelineNodeDefinition(
                id="indexer",
                type="indexer.pinecone",
                name="Indexer",
                config={"dimension": 768},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-source-embedder",
                source="source",
                target="embedder",
                source_port="chunks",
                target_port="chunks",
            ),
            PipelineEdgeDefinition(
                id="edge-embedder-indexer",
                source="embedder",
                target="indexer",
                source_port="embedded",
                target_port="embedded",
            ),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("dimension 768" in error and "dimension 512" in error for error in result.errors)


def test_pipeline_validator_warns_when_dimension_missing() -> None:
    registry = NodeRegistry([_ChunkSourceNode, EmbedderNode, IndexerNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.chunks", name="Source"),
            PipelineNodeDefinition(
                id="embedder",
                type="embedder.openrouter",
                name="Embedder",
                config={"dimension": 512},
            ),
            PipelineNodeDefinition(
                id="indexer",
                type="indexer.pinecone",
                name="Indexer",
                config={"index_name": "test-index"},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-source-embedder",
                source="source",
                target="embedder",
                source_port="chunks",
                target_port="chunks",
            ),
            PipelineEdgeDefinition(
                id="edge-embedder-indexer",
                source="embedder",
                target="indexer",
                source_port="embedded",
                target_port="embedded",
            ),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is True
    assert any("no dimension configured" in warning for warning in result.warnings)


def test_pipeline_validator_requires_inbound_edges_for_indexer() -> None:
    registry = NodeRegistry([_ChunkSourceNode, IndexerNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.chunks", name="Source"),
            PipelineNodeDefinition(
                id="indexer",
                type="indexer.pinecone",
                name="Indexer",
                config={"index_name": "test-index"},
            ),
        ],
        edges=[],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("missing inbound edges" in error for error in result.errors)


def test_pipeline_validator_skips_dimension_for_non_embedder_edge() -> None:
    registry = NodeRegistry([_EmbeddedSourceNode, IndexerNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.embedded", name="Source"),
            PipelineNodeDefinition(
                id="indexer",
                type="indexer.pinecone",
                name="Indexer",
                config={"index_name": "test-index"},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-source-indexer",
                source="source",
                target="indexer",
                source_port="embedded",
                target_port="embedded",
            )
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is True


def test_pipeline_validator_warns_when_embedder_dimension_missing() -> None:
    registry = NodeRegistry([_ChunkSourceNode, EmbedderNode, IndexerNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="source", type="test.chunks", name="Source"),
            PipelineNodeDefinition(
                id="embedder",
                type="embedder.openrouter",
                name="Embedder",
                config={},
            ),
            PipelineNodeDefinition(
                id="indexer",
                type="indexer.pinecone",
                name="Indexer",
                config={"index_name": "test-index", "dimension": 768},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-source-embedder",
                source="source",
                target="embedder",
                source_port="chunks",
                target_port="chunks",
            ),
            PipelineEdgeDefinition(
                id="edge-embedder-indexer",
                source="embedder",
                target="indexer",
                source_port="embedded",
                target_port="embedded",
            ),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is True
    assert any("Embedder node" in warning for warning in result.warnings)


def test_pipeline_validator_requires_retriever_index() -> None:
    registry = NodeRegistry([RetrievalInputNode, EmbedderNode, PineconeRetrieverNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="retrieval.input", name="Input"),
            PipelineNodeDefinition(id="embedder", type="embedder.openrouter", name="Embedder"),
            PipelineNodeDefinition(
                id="retriever",
                type="retriever.pinecone",
                name="Retriever",
                config={"index_name": ""},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="edge-input-retriever",
                source="input",
                target="embedder",
                source_port="request",
                target_port="request",
            ),
            PipelineEdgeDefinition(
                id="edge-embedder-retriever",
                source="embedder",
                target="retriever",
                source_port="query_embedding",
                target_port="query_embedding",
            ),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("must specify an index" in error for error in result.errors)


def test_indexer_node_omitted_index_name_resolves_from_default_settings() -> None:
    """`config={}` must not read as a blank index: validation goes through
    `IndexerConfig`, whose `index_name` default factory resolves from
    settings -- validation and runtime must stay in sync on what "unset"
    means (see app/AGENTS.md's validate-via-config-model rule).
    """
    node = PipelineNodeDefinition(id="indexer", type="indexer.pinecone", name="Indexer", config={})
    definition = PipelineDefinition(nodes=[node], edges=[])
    registry = NodeRegistry([IndexerNode])

    issues = IndexerNode.validation_issues_for_node(node, definition, registry)

    assert IndexerConfig().index_name.strip()
    assert not any("must specify an index" in issue.message for issue in issues)


def test_retriever_node_omitted_index_name_resolves_from_default_settings() -> None:
    """Same guarantee as above for the retriever's index-name validation."""
    node = PipelineNodeDefinition(id="retriever", type="retriever.pinecone", name="Retriever", config={})
    definition = PipelineDefinition(nodes=[node], edges=[])
    registry = NodeRegistry([PineconeRetrieverNode])

    issues = PineconeRetrieverNode.validation_issues_for_node(node, definition, registry)

    assert RetrieverConfig().index_name.strip()
    assert not any("must specify an index" in issue.message for issue in issues)


def test_pipeline_validator_detects_cycles() -> None:
    registry = NodeRegistry([_InputNode])
    definition = PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="a", type="test.input", name="A"),
            PipelineNodeDefinition(id="b", type="test.input", name="B"),
        ],
        edges=[
            PipelineEdgeDefinition(id="edge-a", source="a", target="b"),
            PipelineEdgeDefinition(id="edge-b", source="b", target="a"),
        ],
    )
    result = PipelineValidator(registry).validate(definition)

    assert result.valid is False
    assert any("cycle" in error.lower() for error in result.errors)
