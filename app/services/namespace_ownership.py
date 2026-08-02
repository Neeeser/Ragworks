"""Who owns the data stored under a vector-store namespace.

On a backend whose indexes are shared workspace-wide (pgvector: one
`vec_<name>` table for the whole deployment), the `namespace` column is the
only thing separating one account's chunks from another's. Namespaces are
minted from `DEFAULT_NAMESPACE_TEMPLATE`, so a namespace of the form
`col-<uuid>` names a collection — and that collection names its owner.

Two questions are asked of that mapping, both before something irreversible
happens:

- **may this run read/write here?** — a namespace naming someone else's
  collection is refused, so a hand-typed namespace cannot reach across
  accounts inside a shared index, and
- **whose rows are in this index?** — consulted before dropping a shared
  index, because registration is a declaration while stored rows are a fact.

Namespaces that do not name a collection (free-form values, or collections
since deleted) carry no ownership information and are treated as unowned:
they are nobody's to protect, and refusing them would strand indexes as
undeletable.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository
from app.pipelines.template import NAMESPACE_COLLECTION_PREFIX, resolve_collection_template
from app.services.errors import InvalidInputError


def collection_id_from_namespace(namespace: str) -> UUID | None:
    """Return the collection a namespace names, or `None` if it names none."""
    if not namespace.startswith(NAMESPACE_COLLECTION_PREFIX):
        return None
    try:
        return UUID(namespace[len(NAMESPACE_COLLECTION_PREFIX) :])
    except ValueError:
        return None


def _foreign_collection_id(session: Session, namespace: str, user_id: UUID) -> UUID | None:
    """Return the namespace's collection when another account owns it."""
    collection_id = collection_id_from_namespace(namespace)
    if collection_id is None:
        return None
    collection = CollectionRepository(session).get(collection_id)
    if collection is None or collection.user_id == user_id:
        return None
    return collection_id


def assert_namespace_owned(session: Session, namespace: str, user_id: UUID) -> None:
    """Refuse a namespace that names a collection this account does not own.

    Without this, a pipeline pointed at a shared index can name any
    collection's namespace in a plain config field and read back its chunks —
    the index name and the namespace are the whole of the addressing.
    """
    if _foreign_collection_id(session, namespace, user_id) is None:
        return
    raise InvalidInputError(
        f"Namespace '{namespace}' belongs to another account's collection. "
        "A pipeline can only read and write namespaces of collections you own."
    )


def has_foreign_namespace(session: Session, namespaces: Iterable[str], user_id: UUID) -> bool:
    """Whether any namespace names a collection another account owns."""
    return any(
        _foreign_collection_id(session, namespace, user_id) is not None for namespace in namespaces
    )


def resolve_owned_namespace(
    value: str | None,
    collection: models.Collection,
    session: Session,
) -> str | None:
    """Resolve a node's namespace template, refusing another account's.

    Every store-bound node resolves its namespace through here, so the
    ownership rule is stated once rather than per node.
    """
    rendered = resolve_collection_template(value, collection)
    if rendered:
        assert_namespace_owned(session, rendered, collection.user_id)
    return rendered
