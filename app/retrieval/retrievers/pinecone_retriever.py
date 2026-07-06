"""Pinecone-backed retrieval implementation."""

from __future__ import annotations

from collections.abc import Sequence

from pinecone import Pinecone

from app.clients.pinecone import PineconeMatch, get_pinecone_client

from ..indexers.pinecone_indexer import PineconeIndexConfig
from ..models import DocumentChunk, DocumentMetadata, QueryRequest, RetrievalResponse, ScoredChunk
from ..rerankers.base import Reranker
from .base import Retriever


class PineconeRetriever(Retriever):  # pylint: disable=too-few-public-methods
    """Retriever backed by Pinecone with optional reranking."""

    # pylint: disable=too-many-arguments,too-many-positional-arguments
    def __init__(
        self,
        index_config: PineconeIndexConfig,
        client: Pinecone | None = None,
        api_key: str | None = None,
        reranker: Reranker | None = None,
    ) -> None:
        """Initialize the retriever and Pinecone index handle.

        Uses `client` as-is when provided (test injection); otherwise resolves a
        fresh client from `api_key` via `app.clients.pinecone.get_pinecone_client`.
        """
        self._client = client if client is not None else get_pinecone_client(api_key or "")
        self._index_config = index_config
        self._reranker = reranker
        self._index = self._client.Index(index_config.name)

    def retrieve(self, request: QueryRequest, *, embedding: Sequence[float]) -> RetrievalResponse:
        """Retrieve the most relevant chunks for the query."""
        namespace = request.namespace or self._index_config.namespace

        result = self._index.query(
            vector=list(embedding),
            top_k=request.top_k,
            include_metadata=True,
            include_values=False,
            namespace=namespace,
            filter=request.filter,
        )

        # We never pass `async_req`, so this call always returns a `QueryResponse`
        # synchronously; the SDK's overloads still union in the async `ApplyResult`.
        matches = [PineconeMatch.from_sdk(match) for match in result.matches]  # type: ignore[union-attr]
        scored_chunks = self._convert_matches(matches)

        if self._reranker is not None:
            reranked = self._reranker.rerank(
                query=request.text,
                candidates=scored_chunks,
                top_k=request.top_k,
            )
            return RetrievalResponse(matches=list(reranked))

        return RetrievalResponse(matches=scored_chunks)

    def _convert_matches(self, matches: Sequence[PineconeMatch]) -> list[ScoredChunk]:
        """Convert typed Pinecone matches into scored chunks."""
        scored: list[ScoredChunk] = []
        for match in matches:
            metadata_dict = dict(match.metadata)
            text = metadata_dict.pop(self._index_config.text_key, "")
            document_id = metadata_dict.pop("document_id", match.id)
            order = metadata_dict.pop("order", 0)
            chunk = DocumentChunk(
                document_id=str(document_id),
                chunk_id=match.id,
                text=str(text),
                order=int(order),
                metadata=DocumentMetadata(data=metadata_dict),
            )
            scored.append(ScoredChunk(chunk=chunk, score=float(match.score)))
        return scored
