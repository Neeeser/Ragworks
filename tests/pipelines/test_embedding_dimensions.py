"""Index widths checked against the embedders that write into them."""

from __future__ import annotations

from uuid import UUID, uuid4

from app.pipelines.definition import (
    PipelineDefinition,
    PipelineEdgeDefinition,
    PipelineNodeDefinition,
)
from app.pipelines.embedding_dimensions import embedding_dimension_issues
from app.pipelines.registry import build_default_registry
from app.schemas.enums import IndexBackend

CONNECTION = uuid4()

#: The registry's answer: 'ragworks' is the scaffolded pgvector index.
REGISTERED = {(IndexBackend.PGVECTOR, "ragworks"): 1536}


def _registered_width(backend: IndexBackend, index_name: str) -> int | None:
    return REGISTERED.get((backend, index_name))

#: The catalog answer for the connection's models: a published width for one
#: model, nothing for the model whose provider publishes none.
CATALOG = {"nomic-embed-text": 768, "all-minilm": 384}


def _catalog_width(_connection_id: UUID, model: str) -> int | None:
    return CATALOG.get(model)


def _embedder(model: str, dimension: int | None = None) -> PipelineNodeDefinition:
    config: dict[str, object] = {"connection_id": str(CONNECTION), "model_name": model}
    if dimension is not None:
        config["dimension"] = dimension
    return PipelineNodeDefinition(id="embed", type="embedder.text", name="E", config=config)


def _indexer(dimension: int | None = None, index_name: str = "docs") -> PipelineNodeDefinition:
    config: dict[str, object] = {"backend": "pgvector", "index_name": index_name}
    if dimension is not None:
        config["dimension"] = dimension
    return PipelineNodeDefinition(id="index", type="indexer.vector", name="I", config=config)


def _definition(*nodes: PipelineNodeDefinition) -> PipelineDefinition:
    return PipelineDefinition(
        nodes=list(nodes),
        edges=[
            PipelineEdgeDefinition(
                id="embed-index",
                source="embed",
                target="index",
                source_port="items",
                target_port="items",
            )
        ],
    )


def test_an_embedder_without_a_dimension_field_is_silent_when_the_widths_agree() -> None:
    """The shape the setup wizard produces must not warn about itself.

    An embedder leaves `dimension` unset on purpose — most models reject an
    explicit `dimensions` request — so an empty field says nothing about the
    model's width. The catalog does, and here it matches the index.
    """
    definition = _definition(_embedder("nomic-embed-text"), _indexer(768))

    assert embedding_dimension_issues(definition, build_default_registry(), _catalog_width) == []


def test_a_model_wider_than_its_index_is_an_error_naming_both() -> None:
    """Caught at save time instead of failing every document at ingest."""
    definition = _definition(_embedder("nomic-embed-text"), _indexer(384))

    issues = embedding_dimension_issues(definition, build_default_registry(), _catalog_width)

    assert [issue.severity for issue in issues] == ["error"]
    assert issues[0].node_id == "index"
    assert issues[0].field == "dimension"
    assert "nomic-embed-text" in issues[0].message
    assert "384" in issues[0].message
    assert "768" in issues[0].message


def test_an_unpublished_width_emits_nothing() -> None:
    """A "could not verify" warning would be the noise this check removes."""
    definition = _definition(_embedder("mystery-model"), _indexer(384))

    assert embedding_dimension_issues(definition, build_default_registry(), _catalog_width) == []


def test_an_explicit_request_wins_over_the_catalog_and_is_addressed_to_it() -> None:
    """A reduced (Matryoshka) width is what gets transmitted and stored."""
    definition = _definition(_embedder("nomic-embed-text", dimension=512), _indexer(768))

    issues = embedding_dimension_issues(definition, build_default_registry(), _catalog_width)

    assert [issue.severity for issue in issues] == ["error"]
    assert issues[0].node_id == "embed"
    assert "512" in issues[0].message


def test_an_explicit_request_matching_the_index_is_silent() -> None:
    definition = _definition(_embedder("nomic-embed-text", dimension=512), _indexer(512))

    assert embedding_dimension_issues(definition, build_default_registry(), _catalog_width) == []


def test_the_scaffolded_shape_compares_against_the_index_the_node_names() -> None:
    """The shape every default pipeline has: no dimension on either node.

    Defaults name a registered index rather than restate its width, so a
    blank `dimension` on the indexer does not mean "created at whatever the
    embedder produces" — the index already exists at a fixed width, and a
    narrower model writes vectors it rejects on every document.
    """
    definition = _definition(
        _embedder("nomic-embed-text"),  # 768d
        _indexer(index_name="ragworks"),  # registered at 1536d
    )

    issues = embedding_dimension_issues(
        definition, build_default_registry(), _catalog_width, _registered_width
    )

    assert [issue.severity for issue in issues] == ["error"]
    assert issues[0].node_id == "index"
    # The node's own dimension field is empty; the index it names is what the
    # user would change.
    assert issues[0].field == "index_name"
    assert "ragworks" in issues[0].message
    assert "1536" in issues[0].message
    assert "768" in issues[0].message


def test_an_index_matching_the_model_is_silent() -> None:
    definition = _definition(_embedder("openai-1536"), _indexer(index_name="ragworks"))
    registry = build_default_registry()

    issues = embedding_dimension_issues(
        definition, registry, lambda _connection, _model: 1536, _registered_width
    )

    assert issues == []


def test_an_unregistered_index_stays_unknown_rather_than_guessing() -> None:
    """Not created yet: it will be created at whatever the embedder produces."""
    definition = _definition(_embedder("nomic-embed-text"), _indexer(index_name="not-yet"))

    issues = embedding_dimension_issues(
        definition, build_default_registry(), _catalog_width, _registered_width
    )

    assert issues == []


def test_the_nodes_own_dimension_wins_over_the_index_it_names() -> None:
    """An explicit field is a statement about this graph; the registry is context."""
    definition = _definition(
        _embedder("nomic-embed-text"),  # 768d
        _indexer(dimension=768, index_name="ragworks"),  # registered at 1536d
    )

    issues = embedding_dimension_issues(
        definition, build_default_registry(), _catalog_width, _registered_width
    )

    assert issues == []


def test_a_blank_index_width_warns_only_for_an_explicitly_requested_one() -> None:
    """A blank index takes whatever the first embedding measures.

    That is right by construction for a model's native width, so only a
    reduced request — a choice the index should record — is worth advising.
    """
    requested = _definition(_embedder("nomic-embed-text", dimension=512), _indexer())
    native = _definition(_embedder("nomic-embed-text"), _indexer())
    registry = build_default_registry()

    warnings = embedding_dimension_issues(requested, registry, _catalog_width)

    assert [issue.severity for issue in warnings] == ["warning"]
    assert "no dimension configured" in warnings[0].message
    assert embedding_dimension_issues(native, registry, _catalog_width) == []


def test_an_embedder_without_a_model_adds_no_second_finding() -> None:
    """The embedder already reports its own missing-model error."""
    definition = _definition(
        PipelineNodeDefinition(id="embed", type="embedder.text", name="E", config={}),
        _indexer(768),
    )

    assert embedding_dimension_issues(definition, build_default_registry(), _catalog_width) == []


def test_without_a_resolver_only_an_explicit_request_is_compared() -> None:
    """Execution-time validation has no catalog, and guesses nothing."""
    registry = build_default_registry()
    explicit = _definition(_embedder("nomic-embed-text", dimension=512), _indexer(768))
    native = _definition(_embedder("nomic-embed-text"), _indexer(384))

    assert len(embedding_dimension_issues(explicit, registry, None)) == 1
    assert embedding_dimension_issues(native, registry, None) == []


def test_a_bm25_indexer_has_no_width_to_compare() -> None:
    """Sparse indexes are text-scored; they carry no dimension at all."""
    definition = PipelineDefinition(
        nodes=[
            _embedder("nomic-embed-text"),
            PipelineNodeDefinition(
                id="index",
                type="indexer.bm25",
                name="B",
                config={"backend": "pgvector", "index_name": "docs-bm25"},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="embed-index",
                source="embed",
                target="index",
                source_port="items",
                target_port="items",
            )
        ],
    )

    assert embedding_dimension_issues(definition, build_default_registry(), _catalog_width) == []


def test_one_embedder_feeding_two_indexes_resolves_its_width_once() -> None:
    """Resolution is per embedder, not per edge — one lookup, two findings."""
    calls: list[str] = []

    def counting(_connection_id: UUID, model: str) -> int | None:
        calls.append(model)
        return CATALOG.get(model)

    definition = PipelineDefinition(
        nodes=[
            _embedder("nomic-embed-text"),
            PipelineNodeDefinition(
                id="index",
                type="indexer.vector",
                name="I",
                config={"backend": "pgvector", "index_name": "docs", "dimension": 384},
            ),
            PipelineNodeDefinition(
                id="index-2",
                type="indexer.vector",
                name="I2",
                config={"backend": "pgvector", "index_name": "other", "dimension": 1024},
            ),
        ],
        edges=[
            PipelineEdgeDefinition(
                id="embed-index",
                source="embed",
                target="index",
                source_port="items",
                target_port="items",
            ),
            PipelineEdgeDefinition(
                id="embed-index-2",
                source="embed",
                target="index-2",
                source_port="items",
                target_port="items",
            ),
        ],
    )

    issues = embedding_dimension_issues(definition, build_default_registry(), counting)

    assert calls == ["nomic-embed-text"]
    assert {issue.node_id for issue in issues} == {"index", "index-2"}
