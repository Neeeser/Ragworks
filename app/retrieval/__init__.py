"""Ragworks retrieval module.

Vector-index access (indexing/querying) lives in `app/vectorstores/`; this
package holds the other pluggable RAG stages: parsers, chunkers, embedders,
and rerankers, plus the shared domain models.
"""

# NOTE: Keep imports lightweight so optional dependencies (e.g.
# sentence-transformers) are not pulled in when the retrieval package is
# imported. Users that need concrete implementations such as
# CrossEncoderReranker can import that module directly.

from .chunkers import DocumentChunker
from .embedders import Embedder
from .models import (
    Document,
    DocumentChunk,
    DocumentMetadata,
    QueryRequest,
    RetrievalResponse,
    ScoredChunk,
)
from .parsers import DocumentParser, DocumentSource
from .rerankers import Reranker

__all__ = [
    "Document",
    "DocumentChunk",
    "DocumentChunker",
    "DocumentMetadata",
    "DocumentParser",
    "DocumentSource",
    "Embedder",
    "QueryRequest",
    "Reranker",
    "RetrievalResponse",
    "ScoredChunk",
]
