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

import logging
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
    TokenizerSpec,
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
from app.providers.base import effective_embedding_input_limit
from app.retrieval.embedders.base import Embedder
from app.retrieval.models import DocumentChunk
from app.retrieval.tokenizers.resources import build_token_counter
from app.services.errors import (
    InvalidInputError,
    ServiceError,
    is_external_provider_error,
)

if TYPE_CHECKING:
    from app.pipelines.registry import NodeRegistry

logger = logging.getLogger(__name__)


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
            return self._embed_chunks(embedder, chunks_input, context)
        if request_input is not None:
            return self._embed_query(embedder, request_input)
        raise ValueError("Embedder node requires a chunk batch or query request payload.")

    def _embed_chunks(
        self,
        embedder: Embedder,
        chunks_input: object,
        context: PipelineRunContext,
    ) -> dict[str, object]:
        """Embed a chunk batch and return it as an EmbeddingPayload."""
        payload = ChunkPayload.model_validate(chunks_input)
        document = payload.document
        chunks = self._guard_embedding_inputs(payload, context)
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

    def _guard_embedding_inputs(
        self,
        payload: ChunkPayload,
        context: PipelineRunContext,
    ) -> list[DocumentChunk]:
        """Split provider-bound chunks that exceed the model's effective limit."""
        if self.config.connection_id is None:  # guarded by run(), kept for type narrowing
            return payload.chunks
        published_limit = self._embedding_input_limit(context)
        return self.guard_chunks_for_embedding(payload, published_limit, context)

    @staticmethod
    def guard_chunks_for_embedding(
        payload: ChunkPayload,
        published_limit: int | None,
        context: PipelineRunContext,
    ) -> list[DocumentChunk]:
        """Split a chunk payload once before it fans out to index planes."""
        if published_limit is None:
            return payload.chunks
        limit = effective_embedding_input_limit(published_limit)
        if limit <= 0:
            return payload.chunks

        # A whitespace tokenizer is useful for legacy chunking, but it is not
        # an estimate of model tokens. The runtime guard must use a real model
        # tokenizer whenever the configured tokenizer cannot enforce the provider's
        # limit, otherwise providers may still silently truncate the parts.
        tokenizer = payload.tokenizer
        if tokenizer.kind == "whitespace":
            tokenizer = TokenizerSpec(kind="wordpiece")
        counter = build_token_counter(tokenizer, context.storage.base_path)
        guarded: list[DocumentChunk] = []
        for original_index, chunk in enumerate(payload.chunks):
            token_count = counter.count(chunk.text)
            parts = (
                counter.split(
                    chunk.text,
                    max_tokens=limit,
                    overlap=min(32, limit - 1),
                )
                if token_count > limit
                else [chunk.text]
            )
            if token_count > limit:
                warning = (
                    f"Document {payload.document.document_id} chunk {original_index} contained "
                    f"{token_count} tokens, exceeding the {limit}-token embedding limit, and "
                    f"was split into {len(parts)} parts using the {tokenizer.kind} counter."
                )
                if context.trace is not None:
                    context.trace.record_warning(warning)
            for text in parts:
                order = len(guarded)
                guarded.append(
                    DocumentChunk(
                        document_id=chunk.document_id,
                        chunk_id=f"{chunk.document_id}:{order}",
                        text=text,
                        order=order,
                        metadata=chunk.metadata.model_copy(deep=True),
                    )
                )
        return guarded

    def _embedding_input_limit(self, context: PipelineRunContext) -> int | None:
        """Resolve provider metadata, treating recognized lookup failures as unknown."""
        if self.config.connection_id is None:
            return None
        try:
            return context.providers.embedding_input_limit(
                self.config.connection_id,
                self.config.model_name,
            )
        except Exception as exc:
            if not isinstance(exc, ServiceError) and not is_external_provider_error(exc):
                raise
            logger.warning(
                "Embedding input limit unavailable for connection=%s model=%s: %s",
                self.config.connection_id,
                self.config.model_name,
                exc,
            )
            return None

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
