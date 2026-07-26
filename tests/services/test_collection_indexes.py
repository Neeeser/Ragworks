"""The collection-level index-slot view and the fan-out update.

Slots merge every binding's index variables by name; the update applies one
selection to every binding declaring the slot, which is what keeps ingest
writing where retrieval reads without per-tool dialog rounds.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionPipelineBindingRepository, UserRepository
from app.schemas.collections import CollectionCreate
from app.schemas.enums import IndexBackend
from app.services.collection_indexes import CollectionIndexService
from app.services.collections import CollectionService
from app.services.errors import InvalidInputError
from tests.utils.providers import install_default_pipelines


def _user(session: Session) -> models.User:
    user = models.User(
        email="slots@example.com", full_name="Slots", hashed_password="x"
    )
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    install_default_pipelines(session, user)
    return user


def _collection(session: Session, user: models.User) -> models.Collection:
    return CollectionService(session).create(
        user, CollectionCreate(name="Slots", description="")
    )


def test_read_merges_slots_across_bindings(session: Session) -> None:
    """One slot per variable name, spanning ingest and tool pipelines."""
    user = _user(session)
    collection = _collection(session, user)

    result = CollectionIndexService(session).read(user, collection)

    slots = {slot.name: slot for slot in result.slots}
    assert set(slots) == {"primary_index", "bm25_index"}
    assert slots["primary_index"].vector_type == "dense"
    assert slots["bm25_index"].vector_type == "sparse"
    # Both defaults expose primary_index, so the slot spans both pipelines.
    assert len(slots["primary_index"].pipelines) == 2
    assert slots["primary_index"].current is not None
    assert slots["bm25_index"].current is not None


def test_update_fans_out_to_every_binding_declaring_the_slot(
    session: Session,
) -> None:
    user = _user(session)
    collection = _collection(session, user)
    moved = models.RegisteredIndex(
        user_id=user.id,
        backend=IndexBackend.PGVECTOR,
        name="moved-dense",
        vector_type="dense",
    )
    session.add(moved)
    session.commit()
    session.refresh(moved)

    result = CollectionIndexService(session).update(
        user,
        collection,
        {"primary_index": {"index_id": str(moved.id)}},
    )

    slots = {slot.name: slot for slot in result.slots}
    assert slots["primary_index"].current is not None
    assert slots["primary_index"].current.name == "moved-dense"
    # Every binding moved, read back through a fresh session.
    with Session(session.get_bind()) as fresh:
        bindings = CollectionPipelineBindingRepository(fresh).list_for_collection(
            collection.id
        )
        assert len(bindings) == 2
        for binding in bindings:
            selected = binding.variable_values["primary_index"]
            assert selected["name"] == "moved-dense"
            # The untouched slot keeps its previous selection.
            assert "bm25_index" in binding.variable_values


def test_update_rejects_a_slot_no_binding_declares(session: Session) -> None:
    user = _user(session)
    collection = _collection(session, user)

    with pytest.raises(InvalidInputError, match="binding variable named"):
        CollectionIndexService(session).update(
            user, collection, {"mystery": {"index_id": str(uuid4())}}
        )
