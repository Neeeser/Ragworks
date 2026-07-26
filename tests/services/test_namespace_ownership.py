"""Namespace ownership: the only tenant boundary inside a shared index.

pgvector puts every account's vectors in one `vec_<name>` table, separated
only by the `namespace` column — and `namespace` is an ordinary editable node
config field. A pipeline that names another collection's namespace must be
refused before it reads or writes anything.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.db import models
from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.nodes.indexing import PgvectorIndexerConfig
from app.pipelines.nodes.indexing_legacy import PgvectorIndexerNode
from app.pipelines.payloads import EmbeddingPayload
from app.retrieval.models import Document, DocumentChunk, DocumentMetadata
from app.services.errors import InvalidInputError
from app.services.namespace_ownership import resolve_owned_namespace
from app.utils.file_storage import FileStorage
from tests.pipelines.conftest import (
    StubProviderResolver,
    StubVectorStore,
    StubVectorStoreProvider,
)


def _user(session: Session, email: str) -> models.User:
    """Persist a user who can own collections."""
    user = models.User(email=email, full_name=email, hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _collection(session: Session, user: models.User, name: str) -> models.Collection:
    """Persist a collection whose namespace resolves back to its owner."""
    collection = models.Collection(name=name, description="", user_id=user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_a_namespace_naming_another_accounts_collection_is_refused(session: Session) -> None:
    """The default template makes a collection id the whole of the addressing.

    Type a victim's `col-<uuid>` into the namespace field of a node pointed at
    a shared index and the query returns their chunks, text included.
    """
    victim = _user(session, "victim@example.com")
    victim_collection = _collection(session, victim, "Private corpus")
    attacker = _user(session, "attacker@example.com")
    attacker_collection = _collection(session, attacker, "Mine")

    with pytest.raises(InvalidInputError, match="another account"):
        resolve_owned_namespace(
            f"col-{victim_collection.id}", attacker_collection, session
        )


def test_a_collections_own_namespaces_resolve(session: Session) -> None:
    """The template's own output, and a sibling collection, both stay allowed."""
    owner = _user(session, "owner@example.com")
    first = _collection(session, owner, "First")
    second = _collection(session, owner, "Second")

    assert resolve_owned_namespace("col-{collection_id}", first, session) == f"col-{first.id}"
    assert resolve_owned_namespace(f"col-{second.id}", first, session) == f"col-{second.id}"


def test_namespaces_that_name_no_collection_are_left_alone(session: Session) -> None:
    """Free-form and stale namespaces carry no ownership to enforce.

    Refusing them would strand every pipeline whose collection was deleted,
    and they are nobody's data to protect.
    """
    owner = _user(session, "solo@example.com")
    collection = _collection(session, owner, "Mine")
    deleted = f"col-{uuid4()}"

    assert resolve_owned_namespace("shared-docs", collection, session) == "shared-docs"
    assert resolve_owned_namespace(deleted, collection, session) == deleted


def test_an_indexer_never_reaches_the_store_with_a_foreign_namespace(
    session: Session,
) -> None:
    """The refusal lands before the upsert, not after the write."""
    victim = _user(session, "victim2@example.com")
    victim_collection = _collection(session, victim, "Private")
    attacker = _user(session, "attacker2@example.com")
    attacker_collection = _collection(session, attacker, "Mine")
    store = StubVectorStore()
    context = PipelineRunContext(
        session=session,
        user=attacker,
        collection=attacker_collection,
        document=None,
        query=None,
        top_k=None,
        providers=StubProviderResolver(),
        vector_stores=StubVectorStoreProvider(store),
        storage=FileStorage(),
        settings=get_settings(),
    )
    payload = EmbeddingPayload(
        document=Document(document_id="doc", text="x", metadata=DocumentMetadata()),
        chunks=[
            DocumentChunk(
                document_id="doc",
                chunk_id="doc:0",
                text="x",
                order=0,
                metadata=DocumentMetadata(),
                embedding=[0.1, 0.2],
            )
        ],
        usage={},
    )
    node = PgvectorIndexerNode(
        PgvectorIndexerConfig(
            index_name="docs", dimension=2, namespace=f"col-{victim_collection.id}"
        )
    )

    with pytest.raises(InvalidInputError, match="another account"):
        node.run({"embedded": payload}, context)

    assert store.upsert_calls == []
