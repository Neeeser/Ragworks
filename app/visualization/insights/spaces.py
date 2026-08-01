"""Resolve the vector space a collection's insights are computed in.

The resolver never assumes a pipeline produced embeddings: a collection is
whatever its (possibly weird) ingestion graph made it. When enough chunks
carry consistent embeddings the space is semantic; otherwise it falls back to
a lexical TF-IDF space built from the chunk text every pipeline stores — so a
BM25-only collection gets the same page, honestly labelled with the space its
retrieval actually operates in.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import Pipeline as SkPipeline
from sqlmodel import Session, col, select

from app.db import models
from app.schemas.enums import InsightSpace
from app.services.errors import InvalidInputError
from app.visualization.insights.engine import Array

# Below this many placeable chunks a projection is meaningless.
MIN_CHUNKS = 3

# Lexical vectors are reduced before projection: raw TF-IDF is sparse and
# tens of thousands of dimensions wide, and PaCMAP wants a dense matrix.
LEXICAL_SVD_COMPONENTS = 100

LEXICAL_LABEL = "tf-idf"


@dataclass(frozen=True)
class VectorSpace:
    """A collection's chunks as vectors, ready for kNN and projection.

    `matrix` rows align with `chunk_ids`/`document_ids`/`chunk_indices`;
    `coverage` is the fraction of the collection's chunks the space could
    place (semantic space with partially embedded corpora plots the embedded
    subset rather than failing).
    """

    kind: InsightSpace
    label: str
    chunk_ids: list[UUID]
    document_ids: list[UUID]
    chunk_indices: list[int]
    matrix: Array
    coverage: float
    # Chunk text aligned with the matrix rows — cluster labelling reads it.
    texts: list[str]
    # Fitted lexical transformer (TF-IDF + SVD); present only for lexical
    # spaces, where out-of-sample vectors must come from the same fit.
    lexical_transformer: SkPipeline | None = None


@dataclass(frozen=True)
class ChunkRow:
    """One chunk's identity, vector material, and text."""

    chunk_id: UUID
    document_id: UUID
    chunk_index: int
    embedding: list[float]
    embedding_model: str
    text: str


def load_chunk_rows(session: Session, collection_id: UUID) -> list[ChunkRow]:
    statement = (
        select(models.DocumentChunkRecord)
        .where(col(models.DocumentChunkRecord.collection_id) == collection_id)
        .order_by(
            col(models.DocumentChunkRecord.document_id),
            col(models.DocumentChunkRecord.chunk_index),
        )
    )
    return [
        ChunkRow(
            chunk_id=row.id,
            document_id=row.document_id,
            chunk_index=row.chunk_index,
            embedding=row.embedding,
            embedding_model=row.embedding_model,
            text=row.text,
        )
        for row in session.exec(statement).all()
    ]


def _semantic_space(rows: list[ChunkRow], total: int) -> VectorSpace | None:
    """Build the semantic space from the largest consistent embedding group.

    Chunks are grouped by (model, dimension) because a collection re-ingested
    under a new embedder can legitimately hold a mix; projecting incompatible
    vectors together would place points by an accident of dimensionality.
    """
    groups: dict[tuple[str, int], list[ChunkRow]] = {}
    for row in rows:
        if row.embedding:
            groups.setdefault((row.embedding_model, len(row.embedding)), []).append(row)
    if not groups:
        return None
    (model, _dimension), members = max(groups.items(), key=lambda item: len(item[1]))
    if len(members) < MIN_CHUNKS:
        return None
    matrix = np.array([row.embedding for row in members], dtype=np.float32)
    return VectorSpace(
        kind=InsightSpace.SEMANTIC,
        label=model or "embeddings",
        chunk_ids=[row.chunk_id for row in members],
        document_ids=[row.document_id for row in members],
        chunk_indices=[row.chunk_index for row in members],
        matrix=matrix,
        coverage=len(members) / total,
        texts=[row.text for row in members],
    )


def build_lexical_transformer() -> SkPipeline:
    """TF-IDF + SVD pipeline used for lexical spaces and their probes."""
    return SkPipeline(
        [
            (
                "tfidf",
                TfidfVectorizer(
                    stop_words="english",
                    max_features=20_000,
                    sublinear_tf=True,
                ),
            ),
            # n_components is clamped at fit time (see _lexical_space); this
            # default only matters for corpora large enough to support it.
            ("svd", TruncatedSVD(n_components=LEXICAL_SVD_COMPONENTS, random_state=42)),
        ]
    )


def _lexical_space(rows: list[ChunkRow], total: int) -> VectorSpace:
    members = [row for row in rows if row.text.strip()]
    if len(members) < MIN_CHUNKS:
        raise InvalidInputError(
            "At least three chunks with text are required to compute insights."
        )
    transformer = build_lexical_transformer()
    tfidf = transformer.named_steps["tfidf"].fit_transform([row.text for row in members])
    # SVD rank is bounded by both matrix dimensions; a tiny corpus gets the
    # widest space it can support instead of an sklearn ValueError.
    svd: TruncatedSVD = transformer.named_steps["svd"]
    svd.n_components = max(2, min(LEXICAL_SVD_COMPONENTS, min(tfidf.shape) - 1))
    matrix = svd.fit_transform(tfidf).astype(np.float32)
    return VectorSpace(
        kind=InsightSpace.LEXICAL,
        label=LEXICAL_LABEL,
        chunk_ids=[row.chunk_id for row in members],
        document_ids=[row.document_id for row in members],
        chunk_indices=[row.chunk_index for row in members],
        matrix=matrix,
        coverage=len(members) / total,
        texts=[row.text for row in members],
        lexical_transformer=transformer,
    )


def resolve_space(session: Session, collection_id: UUID) -> VectorSpace:
    """Return the best available vector space for a collection.

    Raises `InvalidInputError` when the collection has too few chunks for any
    space — the caller reports that as the page's honest empty state.
    """
    rows = load_chunk_rows(session, collection_id)
    if len(rows) < MIN_CHUNKS:
        raise InvalidInputError(
            "At least three ingested chunks are required to compute insights."
        )
    semantic = _semantic_space(rows, len(rows))
    if semantic is not None:
        return semantic
    return _lexical_space(rows, len(rows))
