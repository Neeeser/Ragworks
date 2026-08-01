"""Behavior tests for the pure insight compute engine."""

from __future__ import annotations

import numpy as np

from app.visualization.insights import engine


def test_knn_graph_ranks_exact_cosine_neighbors() -> None:
    """Each row's neighbor list is ordered by true cosine similarity."""
    matrix = np.array(
        [
            [1.0, 0.0],
            [0.9, 0.1],  # closest to row 0
            [0.0, 1.0],
            [0.1, 0.9],  # closest to row 2
        ],
        dtype=np.float32,
    )
    graph = engine.knn_graph(matrix, k=2)
    assert graph.indices.shape == (4, 2)
    assert graph.indices[0, 0] == 1
    assert graph.indices[2, 0] == 3
    # Similarities are exact cosines, descending.
    assert graph.similarities[0, 0] > graph.similarities[0, 1]
    expected = float(
        np.dot([1.0, 0.0], [0.9, 0.1]) / (np.linalg.norm([0.9, 0.1]))
    )
    assert abs(float(graph.similarities[0, 0]) - expected) < 1e-5


def test_knn_graph_clamps_k_to_population() -> None:
    """A tiny corpus gets population-1 neighbors, not an sklearn error."""
    matrix = np.eye(3, dtype=np.float32)
    graph = engine.knn_graph(matrix, k=15)
    assert graph.indices.shape == (3, 2)


def test_label_clusters_picks_distinguishing_terms() -> None:
    """A term shared by every cluster never becomes a label; unique ones do."""
    texts = [
        "database index btree postgres storage",
        "database postgres btree vacuum analyze",
        "espresso roast coffee brewing grinder",
        "coffee espresso grinder portafilter brew",
    ]
    labels = np.array([0, 0, 1, 1])
    named = engine.label_clusters(texts, labels)
    assert set(named) == {0, 1}
    assert "postgres" in named[0] or "database" in named[0] or "btree" in named[0]
    assert "coffee" in named[1] or "espresso" in named[1] or "grinder" in named[1]
    assert not set(named[0].split(" · ")) & set(named[1].split(" · "))


def test_label_clusters_ignores_noise_only_input() -> None:
    """All-noise labelling names nothing instead of crashing."""
    assert engine.label_clusters(["a", "b"], np.array([-1, -1])) == {}


def test_doc_edges_keeps_strong_ties_and_deduplicates() -> None:
    """Edges stay above the floor, and an A-B tie appears exactly once."""
    vectors = np.array(
        [
            [1.0, 0.0],
            [0.95, 0.05],  # strongly tied to doc 0
            [0.0, 1.0],  # orthogonal to both
        ],
        dtype=np.float32,
    )
    edges = engine.doc_edges(vectors)
    keys = {(edge.source, edge.target) for edge in edges}
    assert (0, 1) in keys
    assert all(edge.similarity >= engine.DOC_EDGE_SIMILARITY for edge in edges)
    assert len(keys) == len(edges)  # deduplicated


def test_fit_projection_separates_distinct_clusters_and_transform_lands_nearby() -> None:
    """Real PaCMAP: two separated clusters stay separated in 2D, and a new
    point transforms into its own cluster's region without refitting."""
    rng = np.random.default_rng(0)
    a = rng.normal(0.0, 0.05, (40, 16))
    b = rng.normal(1.0, 0.05, (40, 16))
    matrix = np.vstack([a, b]).astype(np.float32)
    reducer, coordinates = engine.fit_projection(matrix)
    center_a = coordinates[:40].mean(axis=0)
    center_b = coordinates[40:].mean(axis=0)
    spread_a = np.linalg.norm(coordinates[:40] - center_a, axis=1).mean()
    assert np.linalg.norm(center_a - center_b) > 2 * spread_a

    new = rng.normal(1.0, 0.05, (3, 16)).astype(np.float32)
    placed = engine.transform_points(reducer, matrix, new)
    dist_b = np.linalg.norm(placed - center_b, axis=1).mean()
    dist_a = np.linalg.norm(placed - center_a, axis=1).mean()
    assert dist_b < dist_a
