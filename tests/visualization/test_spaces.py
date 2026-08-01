"""Behavior tests for vector-space resolution (semantic vs lexical)."""

from __future__ import annotations

import pytest
from sqlmodel import Session

from app.db import models
from app.schemas.enums import InsightSpace
from app.services.errors import InvalidInputError
from app.visualization.insights.spaces import resolve_space
from tests.visualization.conftest import add_document


def test_semantic_space_chosen_when_chunks_carry_embeddings(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    add_document(
        session,
        collection,
        user,
        "a.txt",
        [("alpha", [1.0, 0.0]), ("beta", [0.9, 0.1]), ("gamma", [0.0, 1.0])],
    )
    space = resolve_space(session, collection.id)
    assert space.kind == InsightSpace.SEMANTIC
    assert space.label == "test-embed"
    assert space.matrix.shape == (3, 2)
    assert space.coverage == 1.0


def test_semantic_space_uses_largest_consistent_group_and_reports_coverage(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    """A re-embedded collection mixes models; the majority group wins and
    coverage says how much of the corpus it represents."""
    add_document(
        session,
        collection,
        user,
        "new.txt",
        [("a", [1.0, 0.0, 0.0]), ("b", [0.0, 1.0, 0.0]), ("c", [0.0, 0.0, 1.0])],
        embedding_model="model-new",
    )
    add_document(
        session,
        collection,
        user,
        "old.txt",
        [("d", [1.0, 0.0])],
        embedding_model="model-old",
    )
    space = resolve_space(session, collection.id)
    assert space.label == "model-new"
    assert space.matrix.shape == (3, 3)
    assert space.coverage == pytest.approx(0.75)


def test_lexical_fallback_when_pipeline_produced_no_embeddings(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    """A BM25-only collection still gets a space, built from its own text."""
    add_document(
        session,
        collection,
        user,
        "bm25.txt",
        [
            ("postgres index performance tuning", []),
            ("coffee roasting temperature curves", []),
            ("index vacuum autovacuum settings", []),
            ("espresso grinder burr alignment", []),
        ],
    )
    space = resolve_space(session, collection.id)
    assert space.kind == InsightSpace.LEXICAL
    assert space.label == "tf-idf"
    assert space.matrix.shape[0] == 4
    # SVD rank is clamped to what four tiny documents can support.
    assert space.matrix.shape[1] >= 2
    assert space.lexical_transformer is not None


def test_too_few_chunks_raises_invalid_input(
    session: Session, collection: models.Collection, user: models.User
) -> None:
    add_document(session, collection, user, "tiny.txt", [("only one", [])])
    with pytest.raises(InvalidInputError):
        resolve_space(session, collection.id)
