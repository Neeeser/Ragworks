"""Check each index's vector width against the embedders that write into it.

An index holds one width and rejects every vector of another, so a mismatch
here fails *every* document at ingest time over two numbers the pipeline
already knew while it was being edited.

Both numbers are knowable at save time, and neither is read off the field a
reader first reaches for:

- **The embedder's width** is an explicit `dimension` request when set, else
  the model's native width. `EmbedderConfig.dimension` is a *request sent to
  the provider* — left unset for almost every model, because most reject an
  explicit `dimensions` parameter outright — so an empty field says nothing
  about how wide the model's vectors are. Treating it as "unknown" is what
  made a correct pipeline warn about itself. The width resolver reads the
  provider's catalog first and *measures* it when the catalog publishes none
  (`resolve_embedding_width`), because most providers publish none; its
  cache, not the absence of a probe, is what keeps that safe on a path that
  re-runs on a debounce.
- **The index's width** is the indexer's own `dimension` when set, else the
  width of the registered index the node names. The node field is empty in
  every scaffolded pipeline — defaults name an index rather than restate its
  shape — and a blank field there does *not* mean "created at whatever the
  first embedding measures" once the index exists: it means writing 768d
  vectors into a 1536d store, which is the failure this module exists to
  catch. Only when no registered index answers either is the width unknown.

A width that resolves neither way emits nothing at all: a "could not verify"
warning would recreate exactly the noise this module removes.

This lives at the definition level rather than in the indexer's own validation
hook for the same reason `embedding_limits.py` does: the per-node hook is
given no resolvers, so it can only see config fields.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from uuid import UUID

from pydantic import ValidationError

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.node import PipelineValidationIssue
from app.pipelines.nodes.embedding import EmbedderConfig, EmbedderNode
from app.pipelines.nodes.indexing import BaseIndexerNode, IndexerConfig
from app.pipelines.registry import NodeRegistry
from app.schemas.enums import IndexBackend

EmbeddingDimensionResolver = Callable[[UUID, str], int | None]
IndexWidthResolver = Callable[[IndexBackend, str], int | None]


@dataclass(frozen=True)
class _EmbedderWidth:
    """One embedder's effective output width and where it came from."""

    node_id: str
    model: str
    value: int
    #: True when the node requests a reduced (Matryoshka-style) width, false
    #: when the value is the model's native width. The distinction decides
    #: which node's field a finding is addressed to.
    explicit: bool


@dataclass(frozen=True)
class _IndexWidth:
    """One indexer's target width, and the index it was read from."""

    value: int
    #: The registered index the width came from, or None when the node states
    #: it in its own `dimension` field.
    index_name: str | None


def _embedder_width(
    node: PipelineNodeDefinition,
    resolve_dimension: EmbeddingDimensionResolver | None,
) -> _EmbedderWidth | None:
    """Resolve an embedder's effective width: explicit request, else the model's."""
    try:
        config = EmbedderConfig.model_validate(node.config or {})
    except ValidationError:
        return None
    if config.dimension is not None:
        return _EmbedderWidth(node.id, config.model_name, config.dimension, explicit=True)
    if resolve_dimension is None or config.connection_id is None or not config.model_name:
        # The embedder already reports its own missing-connection/model error.
        return None
    resolved = resolve_dimension(config.connection_id, config.model_name)
    if resolved is None:
        return None
    return _EmbedderWidth(node.id, config.model_name, resolved, explicit=False)


def _index_width(
    node_cls: type[BaseIndexerNode],
    config: IndexerConfig,
    resolve_index_width: IndexWidthResolver | None,
) -> _IndexWidth | None:
    """Resolve an indexer's target width: its own field, else the index it names."""
    if config.dimension is not None:
        return _IndexWidth(config.dimension, index_name=None)
    index_name = config.index_name.strip()
    if resolve_index_width is None or not index_name:
        # A blank index name already reports its own error.
        return None
    registered = resolve_index_width(node_cls.resolve_backend(config), index_name)
    if registered is None:
        return None
    return _IndexWidth(registered, index_name=index_name)


def _target_phrase(target: _IndexWidth, indexer_id: str) -> str:
    """Name where the target width came from, as the user would find it."""
    if target.index_name is None:
        return f"indexer '{indexer_id}' dimension {target.value}"
    return f"index '{target.index_name}', which stores {target.value}-dimension vectors"


def _mismatch_issue(
    indexer_id: str,
    target: _IndexWidth,
    width: _EmbedderWidth,
) -> PipelineValidationIssue:
    """Build the save-time error, addressed to the field that resolves it."""
    if width.explicit:
        # The width is something the embedder asks for, so its own field is
        # the one to change.
        return PipelineValidationIssue(
            code="embedder_index_dimension_mismatch",
            message=(
                f"Embedder node '{width.node_id}' requests dimension {width.value}, "
                f"which does not match {_target_phrase(target, indexer_id)}."
            ),
            severity="error",
            node_id=width.node_id,
            field="dimension",
            configured_value=width.value,
            model=width.model,
        )
    # A model's native width is a fact about the model, so the finding lands
    # on the index side — on the field that actually holds a value there:
    # `dimension` when the node states one, `index_name` when the width
    # belongs to the registered index the node names.
    return PipelineValidationIssue(
        code="embedder_index_dimension_mismatch",
        message=(
            f"Indexer node '{indexer_id}' targets {_target_phrase(target, indexer_id)}, "
            f"but embedding model '{width.model}' on node '{width.node_id}' produces "
            f"{width.value}-dimension vectors."
        ),
        severity="error",
        node_id=indexer_id,
        field="dimension" if target.index_name is None else "index_name",
        configured_value=target.value,
        model=width.model,
    )


def _unknown_target_issue(
    indexer_id: str,
    width: _EmbedderWidth,
) -> PipelineValidationIssue | None:
    """Advise writing a *requested* width onto an index that does not exist yet.

    Reached only when nothing states the target width — the node's field is
    blank and no registered index answers for the name — which is the
    not-created-yet case. Such an index is created at whatever the first
    embedding measures, right by construction for a model's native width, so
    there is nothing to advise. A reduced width is a choice the index should
    record, so the two cannot drift apart later.
    """
    if not width.explicit:
        return None
    return PipelineValidationIssue(
        code="embedder_index_dimension_unset",
        message=(
            f"Indexer node '{indexer_id}' has no dimension configured; ensure it "
            f"matches embedder '{width.node_id}' dimension {width.value}."
        ),
        severity="warning",
        node_id=indexer_id,
        field="dimension",
    )


def _pair_issue(
    indexer_id: str,
    target: _IndexWidth | None,
    width: _EmbedderWidth,
) -> PipelineValidationIssue | None:
    """Judge one embedder/index pair once both widths are resolved."""
    if target is None:
        return _unknown_target_issue(indexer_id, width)
    if target.value == width.value:
        return None
    return _mismatch_issue(indexer_id, target, width)


def _feeding_embedders(
    indexer_id: str,
    definition: PipelineDefinition,
) -> list[PipelineNodeDefinition]:
    """Return the embedder nodes wired directly into one indexer."""
    node_map = definition.node_map()
    sources = (
        node_map.get(edge.source) for edge in definition.incoming_edges().get(indexer_id, [])
    )
    return [node for node in sources if node is not None and node.type == EmbedderNode.type]


def embedding_dimension_issues(
    definition: PipelineDefinition,
    registry: NodeRegistry,
    resolve_dimension: EmbeddingDimensionResolver | None,
    resolve_index_width: IndexWidthResolver | None = None,
) -> list[PipelineValidationIssue]:
    """Return findings comparing index widths with the embedders feeding them.

    Without resolvers only what the nodes state themselves is known — an
    execution-time validation pass has neither a provider catalog nor the
    index registry to consult, and an unknown width is silent by design.
    """
    widths: dict[str, _EmbedderWidth | None] = {}
    issues: list[PipelineValidationIssue] = []
    for node in definition.nodes:
        node_cls = registry.get_node_class(node.type)
        if node_cls is None or not issubclass(node_cls, BaseIndexerNode):
            continue
        try:
            indexer_config = node_cls.config_model.model_validate(node.config or {})
        except ValidationError:
            continue
        target = _index_width(node_cls, indexer_config, resolve_index_width)
        for source in _feeding_embedders(node.id, definition):
            if source.id not in widths:
                widths[source.id] = _embedder_width(source, resolve_dimension)
            width = widths[source.id]
            issue = _pair_issue(node.id, target, width) if width is not None else None
            if issue is not None:
                issues.append(issue)
    return issues
