"""Retriever pipeline nodes.

The retrieval boundary nodes (`retrieval.input`/`retrieval.output`) live in
`io.py` with the ingestion boundaries; fusion nodes live in `fusion.py`;
reranking lives in `reranking.py`.
"""

from __future__ import annotations

import builtins
import logging
from typing import TYPE_CHECKING, ClassVar

from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.nodes.indexing import DEFAULT_PGVECTOR_INDEX_NAME
from app.pipelines.nodes.validators import (
    missing_index_issue,
    missing_top_k_issue,
)
from app.pipelines.payloads import ItemBatch, trace_items
from app.pipelines.ports import Facet, NodePort, PortKind
from app.pipelines.template import namespace_field, resolve_collection_template
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    summarize_matches,
    summarize_text,
)
from app.pipelines.variables import STATIC_ONLY_EXTRA
from app.retrieval.models import RetrievalResponse, ScoredChunk
from app.schemas.enums import IndexBackend
from app.services.app_config import get_app_config
from app.services.errors import InvalidInputError, NotFoundError
from app.services.namespace_ownership import resolve_owned_namespace
from app.vectorstores.registry import CAPABILITIES_BY_BACKEND

if TYPE_CHECKING:
    # Deferred: registry.py imports this module to build the node catalog,
    # so a real import here would be circular. Only used as a type hint.
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)

#: Upper bound on query items one retriever run fans out into store queries.
#: Multi-query retrieval runs one store query per input item, so an unbounded
#: stream (a whole result set wired into a retriever) would issue hundreds of
#: sequential queries; past this size the graph almost certainly wired the
#: wrong stream in, and an honest error beats a minutes-long run.
MAX_QUERY_ITEMS = 32


def ensure_query_fanout(count: int, node_label: str) -> None:
    """Reject a query stream too large to fan out into per-item store queries."""
    if count > MAX_QUERY_ITEMS:
        raise InvalidInputError(
            f"{node_label} received {count} query items; at most "
            f"{MAX_QUERY_ITEMS} are queried per run. Reduce the stream feeding "
            "it (e.g. with a Result Limit node)."
        )


def merge_query_matches(per_query: list[list[ScoredChunk]]) -> list[ScoredChunk]:
    """Merge per-query-item match lists into one ordered list.

    The common single-query case passes through untouched, preserving the
    store's exact order. Multi-query streams union by chunk id, keep each
    chunk's best score, and order by score descending — a chunk matching
    several query items surfaces once, at its strongest.
    """
    if len(per_query) == 1:
        return per_query[0]
    best: dict[str, ScoredChunk] = {}
    for matches in per_query:
        for match in matches:
            chunk_id = match.chunk.chunk_id
            current = best.get(chunk_id)
            if current is None or match.score > current.score:
                best[chunk_id] = match
    return sorted(best.values(), key=lambda match: match.score, reverse=True)


class RetrieverConfig(BaseModel):
    """Configuration for Pinecone retriever nodes.

    `top_k` is how many chunks the node fetches — required for a runnable
    node (validation flags an unset one), but kept optional on the model so
    an in-progress editor draft still parses. Typically the `top_k` variable,
    or an over-retrieval expression (`top_k * 2`) to fetch extra candidates
    for fusion/reranking.
    """

    index_name: str = Field(
        default_factory=lambda: get_settings().pinecone_index_name,
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    namespace: str = namespace_field()
    top_k: int | None = Field(
        default=None,
        gt=0,
        description=(
            "How many chunks to fetch — typically the top_k variable, or an "
            "expression like top_k * 2 to over-retrieve for fusion/reranking."
        ),
    )


class PgvectorRetrieverConfig(RetrieverConfig):
    """Configuration for pgvector retriever nodes (local default index name)."""

    index_name: str = Field(default=DEFAULT_PGVECTOR_INDEX_NAME, json_schema_extra=STATIC_ONLY_EXTRA)


class VectorRetrieverConfig(RetrieverConfig):
    """Unified retriever config: the target backend is data, not a node subtype.

    `index_name` deliberately defaults to empty -- an index must be chosen
    explicitly, and validation flags a blank one (`missing_index_issue`).
    Legacy definitions that relied on the old per-backend defaults get theirs
    filled by the startup migration (`app.pipelines.upgrades`).
    """

    backend: IndexBackend = Field(
        default_factory=lambda: IndexBackend(get_app_config().indexing.default_backend),
        json_schema_extra=STATIC_ONLY_EXTRA,
    )
    index_name: str = Field(default="", json_schema_extra=STATIC_ONLY_EXTRA)


class BaseRetrieverNode(PipelineNodeBase[RetrieverConfig]):
    """Shared retrieval behavior.

    Legacy subclasses pin a backend as a ClassVar; the unified
    `VectorRetrieverNode` leaves it `None` and reads the backend off its
    config (`VectorRetrieverConfig.backend`) via `resolve_backend`.
    """

    backend: ClassVar[IndexBackend | None] = None
    category = "retrieval"
    input_ports = (
        NodePort(
            key="items",
            label="Query Embedding",
            data_type=PortKind.ITEMS,
            requires=(Facet.EMBEDDING,),
        ),
    )
    output_ports = (
        NodePort(
            key="items",
            label="Results",
            data_type=PortKind.ITEMS,
            adds=(Facet.TEXT, Facet.SCORE),
        ),
    )
    # Narrowed from the base's `type[BaseModel]` so validation reads typed fields.
    config_model: builtins.type[RetrieverConfig] = RetrieverConfig

    @classmethod
    def resolve_backend(cls, config: RetrieverConfig) -> IndexBackend:
        """Return the backend this node queries: class-pinned or config-selected."""
        if cls.backend is not None:
            return cls.backend
        if isinstance(config, VectorRetrieverConfig):
            return config.backend
        raise ValueError(f"Node type '{cls.type}' does not declare a vector-store backend.")

    @classmethod
    def supported_backends(cls) -> tuple[IndexBackend, ...]:
        """Pinned nodes support their one backend; unified nodes support all."""
        if cls.backend is not None:
            return (cls.backend,)
        return tuple(CAPABILITIES_BY_BACKEND)

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Validate required index selection and an explicit fetch depth."""
        config = cls.config_model.model_validate(node.config or {})
        issues = [
            missing_index_issue(config.index_name, node.id, "Retriever"),
            missing_top_k_issue(config.top_k, node.id, "Retriever"),
        ]
        return [issue for issue in issues if issue]

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Retrieve chunks for every query item and merge the matches."""
        batch = ItemBatch.model_validate(inputs.get("items"))
        if self.config.top_k is None:  # validation blocks this; honest error if reached
            raise InvalidInputError(
                "Retriever node has no top_k configured. Set how many chunks "
                "it fetches (e.g. the top_k variable) in the pipeline editor."
            )

        namespace = resolve_owned_namespace(
            self.config.namespace, context.collection, context.session
        )
        index_name = (
            resolve_collection_template(self.config.index_name, context.collection)
            or self.config.index_name
        )

        store = context.vector_stores.get(self.resolve_backend(self.config))
        ensure_query_fanout(len(batch.items), "Retriever")
        per_query: list[list[ScoredChunk]] = []
        for item in batch.items:
            if item.embedding is None:
                raise InvalidInputError(
                    f"Retriever received item '{item.id}' without an embedding."
                )
            try:
                response = store.query(
                    index_name,
                    namespace or "",
                    embedding=item.embedding,
                    top_k=self.config.top_k,
                    filter=None,
                )
            except NotFoundError:
                # The index is created by the first ingest; querying before then
                # is an honest empty result, not an error.
                logger.info("Index '%s' does not exist yet; returning no matches.", index_name)
                response = RetrievalResponse(matches=[])
            per_query.append(list(response.matches))
        merged = merge_query_matches(per_query)
        logger.info(
            "Pipeline retrieval returned %s matches for %s query item(s).",
            len(merged),
            len(batch.items),
        )
        return {"items": ItemBatch.from_matches(merged, usage=batch.usage)}

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize retrieval inputs and outputs."""
        input_batch = ItemBatch.model_validate(inputs.get("items"))
        output_batch = ItemBatch.model_validate(outputs.get("items"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(input_batch.query_text() or "", 200),
                    kind="text",
                ),
                NodeTraceValue(label="Top K", value=self.config.top_k),
            ],
            outputs=[
                NodeTraceValue(
                    label="Matches", value=summarize_matches(output_batch.preview_matches())
                ),
                NodeTraceValue(
                    label="Match items", value=trace_items(output_batch.items), kind="items"
                ),
            ],
        )


class VectorRetrieverNode(BaseRetrieverNode):
    """Retrieve relevant chunks from the selected vector-store backend."""

    type = "retriever.vector"
    label = "Retriever"
    description = "Query a vector index (pgvector or Pinecone) for matching chunks."
    example = (
        "Items(embedding=[0.1, 0.2]) -> Items(matches=[chunk_a, chunk_b])."
    )
    config_model: builtins.type[RetrieverConfig] = VectorRetrieverConfig


class PineconeRetrieverNode(BaseRetrieverNode):
    """Deprecated Pinecone-pinned retriever; new pipelines use `retriever.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PINECONE
    type = "retriever.pinecone"
    label = "Pinecone Retriever"
    description = "Retrieve chunks from Pinecone using embeddings."
    example = (
        "Items(embedding=[0.1, 0.2]) -> Items(matches=[chunk_a, chunk_b])."
    )
    hidden = True


class PgvectorRetrieverNode(BaseRetrieverNode):
    """Deprecated pgvector-pinned retriever; new pipelines use `retriever.vector`.

    Kept registered because node type ids are permanent -- persisted pipeline
    versions may still reference it -- but hidden from the editor catalog.
    """

    backend: ClassVar[IndexBackend] = IndexBackend.PGVECTOR
    type = "retriever.pgvector"
    label = "pgvector Retriever"
    description = "Retrieve chunks from the built-in Postgres (pgvector) using embeddings."
    example = (
        "Items(embedding=[0.1, 0.2]) -> Items(matches=[chunk_a, chunk_b])."
    )
    config_model: builtins.type[RetrieverConfig] = PgvectorRetrieverConfig
    hidden = True
