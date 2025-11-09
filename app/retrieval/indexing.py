from __future__ import annotations

import logging
from typing import Optional, Sequence

from .chunkers.base import DocumentChunker
from .embedders.base import Embedder
from .indexers.base import Indexer, VectorIndexConfig
from .models import Document, DocumentChunk
from .parsers import DocumentParser, DocumentSource

logger = logging.getLogger(__name__)


class DocumentIndexer:
    """Coordinates chunking, embedding, and upserting documents into a vector index."""

    def __init__(
        self,
        chunker: DocumentChunker,
        embedder: Embedder,
        indexer: Indexer,
        index_config: VectorIndexConfig,
        parser: Optional[DocumentParser] = None,
    ) -> None:
        self._chunker = chunker
        self._embedder = embedder
        self._indexer = indexer
        self._index_config = index_config
        self._parser = parser

    def ensure_index(self) -> None:
        self._indexer.ensure_index(self._index_config)

    def index_document(
        self,
        document: Document,
        namespace: Optional[str] = None,
        ensure_index: bool = True,
    ) -> Sequence[DocumentChunk]:
        if ensure_index:
            self.ensure_index()

        chunks = list(self._chunker.chunk(document))
        if not chunks:
            logger.warning(
                "Chunker %s produced no chunks for document %s (text chars=%s)",
                self._chunker.__class__.__name__,
                document.document_id,
                len(document.text or ""),
            )
            return []
        chunk_preview = chunks[0].text.replace("\n", " ").strip()[:200]
        chunk_lengths = [len(chunk.text or "") for chunk in chunks]
        if chunk_lengths:
            min_len = min(chunk_lengths)
            max_len = max(chunk_lengths)
            total_len = sum(chunk_lengths)
            avg_len = total_len / len(chunk_lengths)
        else:
            min_len = max_len = total_len = avg_len = 0
        sample_lengths = chunk_lengths[:5]
        logger.info(
            "Chunked document %s into %s chunk(s) via %s (chunk_size=%s overlap=%s). "
            "Chunk char stats min=%s max=%s avg=%.1f total=%s sample=%s. First chunk preview=%r",
            document.document_id,
            len(chunks),
            self._chunker.__class__.__name__,
            getattr(self._chunker, "chunk_size", "n/a"),
            getattr(self._chunker, "overlap", "n/a"),
            min_len,
            max_len,
            avg_len,
            total_len,
            sample_lengths,
            chunk_preview + ("..." if len(chunks[0].text) > 200 else ""),
        )

        embeddings = self._embedder.embed_documents(chunks)
        if len(embeddings) != len(chunks):
            raise ValueError("Mismatch between chunks and embeddings.")

        enriched_chunks = [
            chunk.with_embedding(embedding)
            for chunk, embedding in zip(chunks, embeddings)
        ]

        self._indexer.upsert(
            config=self._index_config,
            chunks=enriched_chunks,
            namespace=namespace,
        )
        return enriched_chunks

    def index_source(
        self,
        source: DocumentSource,
        namespace: Optional[str] = None,
        ensure_index: bool = True,
    ) -> Sequence[DocumentChunk]:
        if self._parser is None:
            raise ValueError("Document parser is not configured for this indexer.")
        document = self._parser.parse(source)
        return self.index_document(
            document=document,
            namespace=namespace,
            ensure_index=ensure_index,
        )

    def index_batch(
        self,
        documents: Sequence[Document],
        namespace: Optional[str] = None,
        ensure_index: bool = True,
    ) -> list[DocumentChunk]:
        combined: list[DocumentChunk] = []
        for document in documents:
            combined.extend(
                self.index_document(
                    document=document,
                    namespace=namespace,
                    ensure_index=ensure_index,
                )
            )
            ensure_index = False  # ensure only on first pass if requested
        return combined

    def index_sources(
        self,
        sources: Sequence[DocumentSource],
        namespace: Optional[str] = None,
        ensure_index: bool = True,
    ) -> list[DocumentChunk]:
        if self._parser is None:
            raise ValueError("Document parser is not configured for this indexer.")

        combined: list[DocumentChunk] = []
        for source in sources:
            combined.extend(
                self.index_source(
                    source=source,
                    namespace=namespace,
                    ensure_index=ensure_index,
                )
            )
            ensure_index = False  # ensure only on first pass if requested
        return combined
