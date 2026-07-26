"""Index administration across users who share one physical pgvector index.

Registered-index identity is per user (`uq_registered_index_identity`), but a
pgvector index name maps to one physical table in the deployment's single
Postgres. Two accounts that both accept the wizard's default therefore write
into the same `vec_<name>` table, isolated only by the `namespace` column —
so deleting "my" index must never drop the table another account is using.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, text

from app.db import models
from app.db.repositories import RegisteredIndexRepository
from app.retrieval.models import DocumentChunk, DocumentMetadata
from app.schemas.enums import IndexBackend
from app.schemas.indexes import IndexCreateRequest, IndexRegisterRequest
from app.services.errors import InvalidInputError, NotFoundError
from app.services.index_admin import IndexAdminService
from tests.utils.vectors import pgvector_store


def _user(session: Session, email: str) -> models.User:
    """Persist a user the index services can own rows for."""
    user = models.User(email=email, full_name=email, hashed_password="x")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _chunk(chunk_id: str) -> DocumentChunk:
    """A minimal embedded chunk for the shared 3-dimension test index."""
    return DocumentChunk(
        document_id="doc-1",
        chunk_id=chunk_id,
        text="chunk text",
        order=0,
        metadata=DocumentMetadata(data={"source": "test.txt"}),
        embedding=[0.1, 0.2, 0.3],
    )


def _shared_index(session: Session) -> tuple[models.User, models.User]:
    """Two users who both registered `ragworks`, each with data of their own.

    Mirrors the live collision on a deployment that predates per-account index
    ownership: the catalog row carries no owner, so both accounts still see
    the name and both could adopt it, and one `vec_ragworks` table holds both
    namespaces.
    """
    owner = _user(session, "owner@example.com")
    neighbor = _user(session, "neighbor@example.com")
    service = IndexAdminService(session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="ragworks", dimension=3, metric="cosine"
        ),
    )
    _clear_owner(session, "ragworks")
    # The neighbor adopts the same name, which is what a shared default
    # produced: their registration row is distinct, the table is not.
    service.register_index(
        neighbor,
        IndexRegisterRequest(backend=IndexBackend.PGVECTOR, name="ragworks"),
    )
    store = pgvector_store(session)
    store.upsert("ragworks", "owner-namespace", [_chunk("owner:0")])
    store.upsert("ragworks", "neighbor-namespace", [_chunk("neighbor:0")])
    session.commit()
    return owner, neighbor


def _clear_owner(session: Session, name: str) -> None:
    """Age a catalog row into the owner-less shape a pre-upgrade DB holds."""
    record = session.get(models.VectorIndexRecord, name)
    assert record is not None
    record.owner_user_id = None
    session.add(record)
    session.commit()


def _namespace_rows(session: Session, namespace: str) -> int:
    """Count surviving rows for one namespace in the shared data table."""
    exists = session.exec(  # type: ignore[call-overload]
        text("SELECT to_regclass('vec_ragworks')")
    ).first()
    if exists is None or exists[0] is None:
        return 0
    return int(
        session.execute(
            text("SELECT count(*) FROM vec_ragworks WHERE namespace = :ns"),
            {"ns": namespace},
        ).scalar_one()
    )


def test_deleting_a_shared_index_never_destroys_another_users_vectors(
    pgvector_session: Session,
) -> None:
    """One account's delete must not drop the table a second account writes to.

    Without the shared-owner guard this drops `vec_ragworks` outright, and the
    neighbor's vectors are gone with nothing in their UI to explain it.
    """
    owner, _neighbor = _shared_index(pgvector_session)

    with pytest.raises(InvalidInputError, match="another account"):
        IndexAdminService(pgvector_session).delete_index(
            owner, IndexBackend.PGVECTOR, "ragworks"
        )

    assert _namespace_rows(pgvector_session, "neighbor-namespace") == 1
    assert _namespace_rows(pgvector_session, "owner-namespace") == 1


def test_an_unregistered_caller_cannot_delete_a_name_another_account_owns(
    pgvector_session: Session,
) -> None:
    """The guard cannot depend on the caller having registered the index.

    Every account sees a shared pgvector name in the Index Manager, so the
    delete is reachable by someone holding no registration row of their own —
    and skipping the check for them destroys the registered owner's vectors.
    """
    _owner, neighbor = _shared_index(pgvector_session)
    stranger = _user(pgvector_session, "stranger@example.com")

    with pytest.raises(InvalidInputError, match="another account"):
        IndexAdminService(pgvector_session).delete_index(
            stranger, IndexBackend.PGVECTOR, "ragworks"
        )

    assert neighbor.id is not None
    assert _namespace_rows(pgvector_session, "neighbor-namespace") == 1


def test_the_sole_owner_of_an_index_can_still_delete_it(
    pgvector_session: Session,
) -> None:
    """The guard is about other accounts only — a private index still deletes."""
    owner = _user(pgvector_session, "solo@example.com")
    service = IndexAdminService(pgvector_session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="ragworks", dimension=3, metric="cosine"
        ),
    )
    pgvector_store(pgvector_session).upsert("ragworks", "owner-namespace", [_chunk("o:0")])
    pgvector_session.commit()

    service.delete_index(owner, IndexBackend.PGVECTOR, "ragworks")

    assert _namespace_rows(pgvector_session, "owner-namespace") == 0
    assert pgvector_store(pgvector_session).list_indexes() == []


def _collection(session: Session, user: models.User, name: str) -> models.Collection:
    """Persist a collection so its namespace resolves back to an owner."""
    collection = models.Collection(name=name, description="", user_id=user.id)
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def test_deleting_a_shared_index_refuses_while_it_still_holds_foreign_rows(
    pgvector_session: Session,
) -> None:
    """Dropping a registration keeps the data, so it cannot end the protection.

    The refusal message tells an account to unregister rather than delete —
    which leaves their vectors in the shared table. A guard reading only
    registrations therefore lets the next caller drop the table under them.
    """
    owner = _user(pgvector_session, "owner@example.com")
    neighbor = _user(pgvector_session, "neighbor@example.com")
    neighbor_collection = _collection(pgvector_session, neighbor, "Neighbor corpus")
    service = IndexAdminService(pgvector_session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="ragworks", dimension=3, metric="cosine"
        ),
    )
    store = pgvector_store(pgvector_session)
    store.upsert("ragworks", "owner-namespace", [_chunk("owner:0")])
    store.upsert(
        "ragworks", f"col-{neighbor_collection.id}", [_chunk("neighbor:0")]
    )
    pgvector_session.commit()
    # The neighbor holds no registration at all: they unregistered, exactly as
    # the shared-name refusal recommends.
    assert not RegisteredIndexRepository(pgvector_session).other_owner_exists(
        owner.id, IndexBackend.PGVECTOR, "ragworks"
    )

    with pytest.raises(InvalidInputError, match="another account"):
        service.delete_index(owner, IndexBackend.PGVECTOR, "ragworks")

    assert _namespace_rows(pgvector_session, f"col-{neighbor_collection.id}") == 1


def test_an_index_holding_only_the_callers_own_collections_still_deletes(
    pgvector_session: Session,
) -> None:
    """The stored-row guard must not strand an account's own index."""
    owner = _user(pgvector_session, "solo@example.com")
    collection = _collection(pgvector_session, owner, "Mine")
    service = IndexAdminService(pgvector_session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="ragworks", dimension=3, metric="cosine"
        ),
    )
    pgvector_store(pgvector_session).upsert(
        "ragworks", f"col-{collection.id}", [_chunk("mine:0")]
    )
    pgvector_session.commit()

    service.delete_index(owner, IndexBackend.PGVECTOR, "ragworks")

    assert _namespace_rows(pgvector_session, f"col-{collection.id}") == 0


def test_another_accounts_index_is_absent_from_the_catalog(
    pgvector_session: Session,
) -> None:
    """One Postgres holds every account's indexes; the listing is still per account.

    An unscoped listing reads every other account's index names straight off
    the catalog, and names describe the corpora behind them.
    """
    owner = _user(pgvector_session, "owner@example.com")
    stranger = _user(pgvector_session, "stranger@example.com")
    service = IndexAdminService(pgvector_session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="acme-contracts", dimension=3, metric="cosine"
        ),
    )

    names = [index.name for index in service.list_indexes(stranger, IndexBackend.PGVECTOR)]
    assert names == []
    with pytest.raises(NotFoundError):
        service.describe_index(stranger, IndexBackend.PGVECTOR, "acme-contracts")

    mine = [index.name for index in service.list_indexes(owner, IndexBackend.PGVECTOR)]
    assert mine == ["acme-contracts"]


def test_an_index_with_no_recorded_owner_stays_visible_and_adoptable(
    pgvector_session: Session,
) -> None:
    """Scoping must not hide indexes created outside the app or before upgrade.

    Those rows carry no owner; hiding them would drop a live collection's
    index out of the registry and make an externally-created one unadoptable.
    """
    owner = _user(pgvector_session, "owner@example.com")
    stranger = _user(pgvector_session, "stranger@example.com")
    service = IndexAdminService(pgvector_session)
    service.create_index(
        owner,
        IndexCreateRequest(
            backend=IndexBackend.PGVECTOR, name="legacy", dimension=3, metric="cosine"
        ),
    )
    _clear_owner(pgvector_session, "legacy")

    names = [index.name for index in service.list_indexes(stranger, IndexBackend.PGVECTOR)]
    assert names == ["legacy"]
    adopted = service.register_index(
        stranger, IndexRegisterRequest(backend=IndexBackend.PGVECTOR, name="legacy")
    )
    assert adopted.registered is True
