"""Embedding node: provider-connection-backed embedder for chunks or queries.

`embedder.text` is one dual-mode node type (chunk batches on the ingestion
side, single queries on the retrieval side); `run()` resolves which mode
applies, then dispatches to `_embed_chunks`/`_embed_query`. The embedder
itself comes from the run context's `ProviderResolver`, so any connection
with the EMBEDDING kind (OpenRouter, Ollama, ...) can serve the node.
(The legacy `embedder.openrouter` id was retired by a startup data migration
that rewrote stored definitions — see `app/services/provider_migration.py`.)
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from pydantic import BaseModel, Field

from app.pipelines.definition import PipelineDefinition, PipelineNodeDefinition
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.node import PipelineNodeBase, PipelineValidationIssue
from app.pipelines.payloads import (
    ChunkPayload,
    EmbeddingPayload,
    QueryEmbeddingPayload,
    RetrievalRequestPayload,
)
from app.pipelines.ports import NodePort
from app.pipelines.tracing import NodeTraceSummary, NodeTraceValue
from app.pipelines.tracing.summaries import (
    TokenUsage,
    summarize_chunks,
    summarize_embeddings,
    summarize_query_embedding,
    summarize_text,
)
from app.retrieval.embedders.base import Embedder
from app.services.errors import InvalidInputError

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry


class EmbedderConfig(BaseModel):
    """Configuration for embedding nodes.

    `connection_id` names the provider connection that serves the model; both
    it and `model_name` are required for a runnable node, but stay optional on
    the model so an incomplete draft validates in the editor and surfaces
    through node validation instead of a parse crash.
    """

    connection_id: UUID | None = Field(
        default=None,
        description="Provider connection that serves the embedding model.",
    )
    model_name: str = ""
    dimension: int | None = Field(
        default=None,
        gt=0,
        description="Optional override for the embedding vector dimension.",
    )


class EmbedderNode(PipelineNodeBase[EmbedderConfig]):
    """Generate embeddings for document chunks or a retrieval query.

    Exactly one of the `chunks`/`request` input ports is connected in any
    given pipeline; `run()` resolves which mode applies before dispatching.
    """

    type = "embedder.text"
    label = "Embedder"
    category = "ingestion"
    description = "Embed text using a configured provider connection."
    example = "ChunkPayload(chunks=['hello']) -> EmbeddingPayload(embeddings=[[0.12, 0.03, ...]])."
    input_ports = (
        NodePort(key="chunks", label="Chunks", data_type="chunk_batch", required=False),
        NodePort(key="request", label="Request", data_type="query_request", required=False),
    )
    output_ports = (
        NodePort(key="embedded", label="Embedded", data_type="embedded_batch", required=False),
        NodePort(
            key="query_embedding",
            label="Query Embedding",
            data_type="query_embedding",
            required=False,
        ),
    )
    config_model = EmbedderConfig

    @classmethod
    def validation_issues_for_node(
        cls,
        node: PipelineNodeDefinition,
        _definition: PipelineDefinition,
        _registry: NodeRegistry,
    ) -> list[PipelineValidationIssue]:
        """Flag an embedder that has no provider connection or model configured."""
        config = EmbedderConfig.model_validate(node.config or {})
        issues: list[PipelineValidationIssue] = []
        if config.connection_id is None:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Embedder node '{node.id}' has no provider connection "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        if not config.model_name:
            issues.append(
                PipelineValidationIssue(
                    message=(
                        f"Embedder node '{node.id}' has no embedding model "
                        "configured. Pick one in the pipeline editor."
                    ),
                    severity="error",
                )
            )
        return issues

    def run(self, inputs: dict[str, object], context: PipelineRunContext) -> dict[str, object]:
        """Resolve the embedding mode and dispatch to the matching unit."""
        chunks_input = inputs.get("chunks")
        request_input = inputs.get("request")
        if chunks_input is not None and request_input is not None:
            raise ValueError("Embedder node cannot process both chunks and request payloads.")

        if self.config.connection_id is None or not self.config.model_name:
            raise InvalidInputError(
                "Embedder node needs a provider connection and model. "
                "Pick them in the pipeline editor."
            )
        embedder = context.providers.embedder(
            self.config.connection_id,
            self.config.model_name,
            dimensions=self.config.dimension,
        )
        if chunks_input is not None:
            return self._embed_chunks(embedder, chunks_input)
        if request_input is not None:
            return self._embed_query(embedder, request_input)
        raise ValueError("Embedder node requires a chunk batch or query request payload.")

    @staticmethod
    def _embed_chunks(embedder: Embedder, chunks_input: object) -> dict[str, object]:
        """Embed a chunk batch and return it as an EmbeddingPayload."""
        payload = ChunkPayload.model_validate(chunks_input)
        document = payload.document
        chunks = payload.chunks
        embeddings = embedder.embed_documents(chunks)
        if len(embeddings) != len(chunks):
            raise ValueError("Embedder returned mismatched embeddings.")
        enriched_chunks = [
            chunk.with_embedding(embedding)
            for chunk, embedding in zip(chunks, embeddings, strict=True)
        ]
        usage = TokenUsage.model_validate(embedder.usage or {})
        return {
            "embedded": EmbeddingPayload(
                document=document,
                chunks=enriched_chunks,
                usage=usage,
            )
        }

    @staticmethod
    def _embed_query(embedder: Embedder, request_input: object) -> dict[str, object]:
        """Embed a single query and return it as a QueryEmbeddingPayload."""
        payload = RetrievalRequestPayload.model_validate(request_input)
        request = payload.request
        embedding = embedder.embed_query(request.text)
        usage = TokenUsage.model_validate(embedder.usage or {})
        return {
            "query_embedding": QueryEmbeddingPayload(
                request=request,
                embedding=embedding,
                usage=usage,
            )
        }

    def summarize_io(
        self,
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize embedding inputs and outputs for whichever mode ran."""
        if "embedded" in outputs:
            return self._summarize_chunks_io(inputs, outputs)
        return self._summarize_query_io(inputs, outputs)

    @staticmethod
    def _summarize_chunks_io(
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the chunk-embedding mode's inputs and outputs."""
        input_payload = ChunkPayload.model_validate(inputs.get("chunks"))
        output_payload = EmbeddingPayload.model_validate(outputs.get("embedded"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Chunk text",
                    value=summarize_chunks(input_payload.chunks),
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Embeddings",
                    value=summarize_embeddings(output_payload.chunks),
                    kind="embedding",
                )
            ],
        )

    @staticmethod
    def _summarize_query_io(
        inputs: dict[str, object],
        outputs: dict[str, object],
    ) -> NodeTraceSummary:
        """Summarize the query-embedding mode's inputs and outputs."""
        input_payload = RetrievalRequestPayload.model_validate(inputs.get("request"))
        output_payload = QueryEmbeddingPayload.model_validate(outputs.get("query_embedding"))
        return NodeTraceSummary(
            inputs=[
                NodeTraceValue(
                    label="Query",
                    value=summarize_text(input_payload.request.text),
                    kind="text",
                )
            ],
            outputs=[
                NodeTraceValue(
                    label="Embedding",
                    value=summarize_query_embedding(output_payload.embedding),
                    kind="embedding",
                )
            ],
        )
