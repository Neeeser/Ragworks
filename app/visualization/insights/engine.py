"""Pure numeric compute for collection insights.

Everything here is stateless math over matrices: kNN graphs, PaCMAP
projections, HDBSCAN clusters, and c-TF-IDF cluster labels. Persistence and
scheduling live in the service; this module never touches the database.
"""

from __future__ import annotations

import pickle
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, TypeAlias, cast

import numpy as np
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


# Generous ceiling on one subprocess projection call; a hung fit surfaces
# as a failed snapshot instead of a worker stuck forever.
PROJECTION_TIMEOUT_SECONDS = 900


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
    """Compute each row's k nearest neighbors by cosine similarity.

    Self-matches are filtered by index, never by dropping the first column:
    exact-duplicate rows (the near-duplicate chunks this graph exists to
    surface) tie at distance zero, so the query row's own entry can land in
    any column — dropping column 0 would then silently delete the strongest
    cross-document edge and keep a useless self-edge instead.
    """
    n = matrix.shape[0]
    k = min(k, n - 1)
    unit = normalized(matrix)
    finder = NearestNeighbors(n_neighbors=min(k + 1, n), metric="cosine").fit(unit)
    distances, indices = finder.kneighbors(unit)
    out_indices = np.empty((n, k), dtype=np.int64)
    out_sims = np.empty((n, k), dtype=np.float32)
    for i in range(n):
        kept = [
            (int(j), float(d))
            for j, d in zip(indices[i], distances[i], strict=True)
            if int(j) != i
        ][:k]
        out_indices[i] = [j for j, _ in kept]
        out_sims[i] = [min(1.0, max(-1.0, 1.0 - d)) for _, d in kept]
    return KnnGraph(indices=out_indices, similarities=out_sims)


def _run_projection(request: dict[str, object]) -> dict[str, Any]:
    """Execute a projection request in a child interpreter.

    pacmap's faiss+numba OpenMP runtimes conflict with the sklearn already
    loaded here, in platform-dependent init orders that segfault (macOS).
    A child that imports only numpy/numba/pacmap is the one arrangement
    that is safe everywhere, so every projection call pays a subprocess —
    acceptable for a background compute path. See `projection_worker` for
    why this is a bare subprocess rather than `multiprocessing`.
    """
    completed = subprocess.run(
        [sys.executable, "-m", "app.visualization.insights.projection_worker"],
        input=pickle.dumps(request),
        capture_output=True,
        timeout=PROJECTION_TIMEOUT_SECONDS,
        check=False,
    )
    if completed.returncode != 0:
        tail = completed.stderr.decode(errors="replace")[-500:]
        raise RuntimeError(f"Projection subprocess died (rc={completed.returncode}): {tail}")
    reply = cast(dict[str, Any], pickle.loads(completed.stdout))
    if not reply.get("ok"):
        raise RuntimeError(f"Projection failed: {reply.get('error', 'unknown error')}")
    return reply


def fit_projection(matrix: Array, random_state: int = 42) -> tuple[bytes, Array]:
    """Fit a PaCMAP projection; returns (pickled reducer, 2D coordinates)."""
    reply = _run_projection({"op": "fit", "matrix": matrix, "random_state": random_state})
    coordinates = np.asarray(reply["coordinates"], dtype=np.float64)
    if not np.isfinite(coordinates).all():
        raise ValueError("Projection produced non-finite coordinates.")
    return cast(bytes, reply["blob"]), coordinates


def transform_points(reducer_blob: bytes, basis: Array, new: Array) -> Array:
    """Place new vectors into an existing projection without moving it."""
    reply = _run_projection(
        {"op": "transform", "blob": reducer_blob, "basis": basis, "new": new}
    )
    coordinates = np.asarray(reply["coordinates"], dtype=np.float64)
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
