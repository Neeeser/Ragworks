"""A node's real modality contract comes from the model it runs.

Two behaviours, both only observable through the validator: a vision node
whose model cannot read images is rejected before it ever runs, and an
embedder whose model *can* read them stops the graph analysis reporting
its images as lost.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.model_modalities import accepts_image_queries
from app.pipelines.registry import default_registry
from app.pipelines.validation import PipelineValidator
from app.schemas.enums import ProviderKind

CONNECTION = uuid4()


def _publishing(*modalities: str):
    """A modality resolver whose catalog publishes exactly `modalities`."""

    def resolve(_connection: UUID, _model: str, _kind: ProviderKind) -> frozenset[str]:
        return frozenset(modalities)

    return resolve


def _describe_pipeline() -> PipelineDefinition:
    """PDF -> extract images -> describe -> BM25 index."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="ingestion.input", name="Input"),
            PipelineNodeDefinition(id="images", type="parse.embedded_media", name="Extract Media"),
            PipelineNodeDefinition(
                id="describe",
                type="llm.describe",
                name="Vision",
                config={
                    "connection_id": str(CONNECTION),
                    "model_name": "some-model",
                    "prompt": "Describe this image.",
                    "output_fields": [
                        {
                            "name": "description",
                            "type": "string",
                            "description": "What the image shows.",
                            "target": {"kind": "text", "mode": "append", "separator": "\n\n"},
                        }
                    ],
                },
            ),
            PipelineNodeDefinition(
                id="bm25",
                type="indexer.bm25",
                name="BM25",
                config={"backend": "pgvector", "index_name": "docs-bm25"},
            ),
            PipelineNodeDefinition(id="out", type="ingestion.output", name="Out"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="input", target="images", source_port="items", target_port="source"
            ),
            PipelineEdgeDefinition(
                id="e2", source="images", target="describe", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e3", source="describe", target="bm25", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e4", source="bm25", target="out", source_port="items", target_port="items"
            ),
        ],
    )


def test_a_text_only_model_on_a_vision_node_is_rejected() -> None:
    result = PipelineValidator(
        default_registry(), model_modalities=_publishing("text")
    ).validate(_describe_pipeline())

    assert result.valid is False
    assert any(
        "does not accept image input" in issue.message and issue.node_id == "describe"
        for issue in result.issues
    )


def test_an_image_capable_model_on_a_vision_node_passes() -> None:
    result = PipelineValidator(
        default_registry(), model_modalities=_publishing("text", "image")
    ).validate(_describe_pipeline())

    assert [issue.message for issue in result.issues if issue.severity == "error"] == []


def test_a_provider_publishing_no_modalities_is_not_second_guessed() -> None:
    """Most catalogs publish nothing; refusing those models would break them all."""
    result = PipelineValidator(default_registry(), model_modalities=_publishing()).validate(
        _describe_pipeline()
    )

    assert not any("does not accept" in issue.message for issue in result.issues)


def _embedder_pipeline() -> PipelineDefinition:
    """PDF -> extract images -> embed -> dense index."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="input", type="ingestion.input", name="Input"),
            PipelineNodeDefinition(id="images", type="parse.embedded_media", name="Extract Media"),
            PipelineNodeDefinition(
                id="embed",
                type="embedder.text",
                name="Embedder",
                config={"connection_id": str(CONNECTION), "model_name": "some-embed"},
            ),
            PipelineNodeDefinition(
                id="dense",
                type="indexer.vector",
                name="Indexer",
                config={"backend": "pgvector", "index_name": "docs", "dimension": 768},
            ),
            PipelineNodeDefinition(id="out", type="ingestion.output", name="Out"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="input", target="images", source_port="items", target_port="source"
            ),
            PipelineEdgeDefinition(
                id="e2", source="images", target="embed", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e3", source="embed", target="dense", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e4", source="dense", target="out", source_port="items", target_port="items"
            ),
        ],
    )


@pytest.mark.parametrize(
    ("published", "expect_lost"),
    [
        (("text",), True),
        (("text", "image"), False),
    ],
    ids=["text-only model loses the images", "image-capable model indexes them"],
)
def test_the_embedder_model_decides_whether_images_reach_the_index(
    published: tuple[str, ...], expect_lost: bool
) -> None:
    """The warning the user sees depends on the model, not the node type.

    An embedding model that reads images makes this exact graph correct;
    the same graph with a text-only model silently indexes nothing from
    the PDF's figures, which is what the finding is for.
    """
    result = PipelineValidator(
        default_registry(), model_modalities=_publishing(*published)
    ).validate(_embedder_pipeline())

    lost = [
        issue
        for issue in result.issues
        if issue.code == "modality.lost_modality" and issue.node_id == "images"
    ]
    assert bool(lost) is expect_lost
    if expect_lost:
        assert "reach no node that accepts them" in lost[0].message


def test_the_spec_names_which_nodes_models_widen() -> None:
    """The editor's instant analysis reads this flag off the node catalog.

    A widening node's client-side findings are filtered to those no model
    choice can cure; a missing flag would flash a false warning on every
    multimodal embedder until the server round-trip answered.
    """
    registry = default_registry()
    widens = {
        node_type: spec.model_widens_accepts
        for node_type in ("embedder.text", "llm.describe", "indexer.bm25")
        if (spec := registry.get_spec(node_type)) is not None
    }
    assert widens == {"embedder.text": True, "llm.describe": False, "indexer.bm25": False}


def _search_pipeline(node_type: str = "embedder.text") -> PipelineDefinition:
    """Query -> embed -> dense retrieve -> output, the shipped search shape."""
    return PipelineDefinition(
        nodes=[
            PipelineNodeDefinition(id="query", type="retrieval.input", name="Query"),
            PipelineNodeDefinition(
                id="embed",
                type=node_type,
                name="Embedder",
                config={"connection_id": str(CONNECTION), "model_name": "some-embed"},
            ),
            PipelineNodeDefinition(
                id="dense",
                type="retriever.vector",
                name="Retriever",
                config={"backend": "pgvector", "index_name": "docs", "top_k": 5},
            ),
            PipelineNodeDefinition(id="out", type="retrieval.output", name="Out"),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="e1", source="query", target="embed", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e2", source="embed", target="dense", source_port="items", target_port="items"
            ),
            PipelineEdgeDefinition(
                id="e3", source="dense", target="out", source_port="items", target_port="items"
            ),
        ],
    )


class _CatalogProviders:
    """Provider resolver stand-in publishing one modality set for every model."""

    def __init__(self, modalities: frozenset[str]) -> None:
        self.modalities = modalities

    def input_modalities(
        self, _connection_id: UUID, _model_name: str, _kind: ProviderKind
    ) -> frozenset[str]:
        return self.modalities


class TestWhetherAGraphCanBeAskedWithAnImage:
    """`accepts_image_queries` is what the query surfaces gate an image on."""

    @pytest.mark.parametrize(
        ("published", "accepts"),
        [
            (frozenset({"text", "image"}), True),
            (frozenset({"text"}), False),
            (frozenset(), True),
        ],
        ids=[
            "an image-capable embedding model takes the query",
            "a text-only embedding model cannot",
            "a catalog publishing nothing is not refused",
        ],
    )
    def test_the_embedding_model_decides(
        self, published: frozenset[str], accepts: bool
    ) -> None:
        answer = accepts_image_queries(
            _search_pipeline(), default_registry(), _CatalogProviders(published)
        )

        assert answer is accepts

    def test_a_node_declaring_image_intake_answers_without_a_catalog(self) -> None:
        """A vision shell processes images whichever model it runs."""
        definition = _search_pipeline()
        definition.nodes.append(
            PipelineNodeDefinition(
                id="describe",
                type="llm.describe",
                name="Vision",
                config={"connection_id": str(CONNECTION), "model_name": "vision"},
            )
        )

        answer = accepts_image_queries(
            definition, default_registry(), _CatalogProviders(frozenset({"text"}))
        )

        assert answer is True

    def test_a_model_left_unconfigured_is_not_treated_as_capable(self) -> None:
        """A draft names no model, so nothing was published to be permissive about."""
        definition = _search_pipeline()
        definition.node_map()["embed"].config = {}

        answer = accepts_image_queries(
            definition, default_registry(), _CatalogProviders(frozenset({"text", "image"}))
        )

        assert answer is False
