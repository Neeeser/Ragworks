"""Pure numeric compute for collection insights.

Everything here is stateless math over matrices: kNN graphs, PaCMAP
projections, HDBSCAN clusters, and c-TF-IDF cluster labels. Persistence and
scheduling live in the service; this module never touches the database.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, TypeAlias

import numpy as np
from numba import njit, prange
from sklearn.cluster import HDBSCAN
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.neighbors import NearestNeighbors

KNN_NEIGHBORS = 15
# Cross-document pairs at or above this cosine similarity are reported as
# retrieval-confusable overlaps.
OVERLAP_SIMILARITY = 0.85
# Document-graph edges keep each document's strongest ties above this floor.
DOC_EDGE_SIMILARITY = 0.5
DOC_EDGE_TOP_K = 5
CLUSTER_LABEL_TERMS = 3

# numpy's generic parameters carry no useful narrowing for this module's
# mixed float/int matrices; `Any` here fills a generic slot, per house style.
Array: TypeAlias = np.ndarray[Any, np.dtype[Any]]


class Projector(Protocol):
    """The slice of PaCMAP's surface the engine and its pickle bundle rely on."""

    def fit_transform(self, X: Array) -> Array: ...

    def transform(self, X: Array, basis: Array) -> Array: ...


_numba_warmed = False


@njit(parallel=True, cache=False)  # type: ignore[untyped-decorator]  # numba ships no types
def _warm_kernel(values: Array) -> float:  # pragma: no cover - trivial jit body
    total = 0.0
    for i in prange(values.shape[0]):
        total += values[i]
    return total


def warm_numba() -> None:
    """Initialize numba's OpenMP runtime before any faiss call.

    pacmap uses faiss for its internal kNN and numba for its optimizer; on
    macOS, letting faiss create its OpenMP pool first segfaults numba's
    first parallel region (two libomp runtimes, wrong init order). Running
    one trivial numba-parallel kernel first makes the full sequence safe —
    verified empirically; there is no pure-Python way to express this
    constraint, so it is enforced by calling this before pacmap.
    """
    global _numba_warmed
    if _numba_warmed:
        return
    _warm_kernel(np.arange(16.0))
    _numba_warmed = True


def normalized(matrix: Array) -> Array:
    """L2-normalize rows so dot products are cosine similarities."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return np.asarray(matrix / norms, dtype=np.float32)


@dataclass(frozen=True)
class KnnGraph:
    """Each row's top-k neighbors (indices into the space's row order)."""

    indices: Array  # (n, k) int
    similarities: Array  # (n, k) float


def knn_graph(matrix: Array, k: int = KNN_NEIGHBORS) -> KnnGraph:
    """Compute each row's k nearest neighbors by cosine similarity."""
    n = matrix.shape[0]
    k = min(k, n - 1)
    unit = normalized(matrix)
    finder = NearestNeighbors(n_neighbors=k + 1, metric="cosine").fit(unit)
    distances, indices = finder.kneighbors(unit)
    # Column 0 is each row itself (distance 0); similarity = 1 - cosine dist.
    return KnnGraph(
        indices=indices[:, 1:].astype(np.int64),
        similarities=np.clip(1.0 - distances[:, 1:], -1.0, 1.0).astype(np.float32),
    )


def fit_projection(
    matrix: Array, random_state: int = 42
) -> tuple[Projector, Array]:
    """Fit a PaCMAP projection and return (reducer, 2D coordinates)."""
    import pacmap

    warm_numba()
    n = matrix.shape[0]
    reducer: Projector = pacmap.PaCMAP(
        n_components=2,
        n_neighbors=min(10, max(2, n - 2)),
        distance="angular",
        random_state=random_state,
    )
    coordinates = np.asarray(reducer.fit_transform(matrix), dtype=np.float64)
    if not np.isfinite(coordinates).all():
        raise ValueError("Projection produced non-finite coordinates.")
    return reducer, coordinates


def transform_points(reducer: Projector, basis: Array, new: Array) -> Array:
    """Place new vectors into an existing projection without moving it."""
    warm_numba()
    coordinates = np.asarray(reducer.transform(new, basis=basis), dtype=np.float64)
    if not np.isfinite(coordinates).all():
        raise ValueError("Incremental transform produced non-finite coordinates.")
    return coordinates


def cluster_points(coordinates: Array) -> Array:
    """HDBSCAN over the 2D layout; -1 marks noise.

    Clustering the projected plane (rather than the high-dim space) keeps the
    clusters the user reads off the map identical to the groups the algorithm
    reports — the labels annotate what the eye already sees.
    """
    n = coordinates.shape[0]
    if n < 10:
        return np.full(n, -1, dtype=np.int64)
    min_cluster_size = max(5, n // 100)
    labels = HDBSCAN(min_cluster_size=min_cluster_size).fit_predict(coordinates)
    return np.asarray(labels, dtype=np.int64)


def label_clusters(texts: list[str], labels: Array) -> dict[int, str]:
    """Name each cluster by its most distinguishing terms (c-TF-IDF).

    Per cluster: term counts over the cluster's concatenated text, weighted
    by log-inverse document frequency across clusters, so a term shared by
    every cluster never becomes anyone's label. Local and free — no LLM.
    """
    cluster_ids = sorted({int(label) for label in labels if label >= 0})
    if not cluster_ids:
        return {}
    documents = [
        " ".join(text for text, label in zip(texts, labels, strict=True) if label == cid)
        for cid in cluster_ids
    ]
    vectorizer = CountVectorizer(stop_words="english", max_features=10_000)
    try:
        counts = vectorizer.fit_transform(documents)
    except ValueError:  # only stop words / empty text — nothing to name
        return {}
    counts = np.asarray(counts.todense(), dtype=np.float64)
    tf = counts / np.maximum(counts.sum(axis=1, keepdims=True), 1.0)
    df = np.count_nonzero(counts, axis=0)
    idf = np.log(1.0 + len(cluster_ids) / np.maximum(df, 1))
    scores = tf * idf
    terms = np.asarray(vectorizer.get_feature_names_out())
    result: dict[int, str] = {}
    for row, cid in enumerate(cluster_ids):
        top = np.argsort(scores[row])[::-1][:CLUSTER_LABEL_TERMS]
        chosen = [str(terms[i]) for i in top if scores[row, i] > 0.0]
        if chosen:
            result[cid] = " · ".join(chosen)
    return result


@dataclass(frozen=True)
class DocEdge:
    """A doc-to-doc similarity edge (indices into the doc order)."""

    source: int
    target: int
    similarity: float


def doc_edges(doc_vectors: Array) -> list[DocEdge]:
    """Strongest centroid-similarity edges per document, deduplicated.

    Document counts are small next to chunk counts, so a dense doc-by-doc
    product is fine; each document keeps its top-k ties above the floor.
    """
    n = doc_vectors.shape[0]
    if n < 2:
        return []
    unit = normalized(doc_vectors)
    sims = unit @ unit.T
    edges: dict[tuple[int, int], float] = {}
    for source in range(n):
        order = np.argsort(sims[source])[::-1]
        kept = 0
        for target in order:
            if target == source:
                continue
            similarity = float(sims[source, target])
            if similarity < DOC_EDGE_SIMILARITY or kept >= DOC_EDGE_TOP_K:
                break
            key = (min(source, int(target)), max(source, int(target)))
            edges[key] = max(edges.get(key, 0.0), similarity)
            kept += 1
    return [
        DocEdge(source=source, target=target, similarity=similarity)
        for (source, target), similarity in edges.items()
    ]
