"""HTTP contract for the collection asset route.

Retrieval matches carry a storage-relative asset path
(`ragworks.image_asset` metadata); this route is how the client fetches
the bytes. The contract worth pinning is the authorization boundary: the
path must live under the requested collection's own directory.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import CollectionRepository
from app.utils.file_storage import FileStorage

PNG_BYTES = b"\x89PNG\r\n\x1a\n-test-bytes"


@pytest.fixture(name="collection")
def collection_fixture(session: Session, auth_user: models.User) -> models.Collection:
    collection = models.Collection(
        user_id=auth_user.id, name="Assets", description="", extra_metadata={}
    )
    CollectionRepository(session).add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def _store_asset(collection_id: UUID) -> str:
    relative = f"collections/{collection_id}/derived/doc-1/page1-0.png"
    FileStorage().write_bytes(PNG_BYTES, relative)
    return relative


def test_asset_streams_with_its_media_type(
    client: TestClient, collection: models.Collection
) -> None:
    relative = _store_asset(collection.id)

    response = client.get(f"/api/collections/{collection.id}/assets/{relative}")

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_a_path_into_another_collection_is_not_served(
    client: TestClient, collection: models.Collection, session: Session, auth_user: models.User
) -> None:
    """Owning one collection never reads another's directory.

    The user owns the collection in the URL, but the path names a different
    collection's asset — the prefix check is the boundary, so the answer is
    404 whether or not that other asset exists.
    """
    other = models.Collection(
        user_id=auth_user.id, name="Other", description="", extra_metadata={}
    )
    CollectionRepository(session).add(other)
    session.commit()
    session.refresh(other)
    relative = _store_asset(other.id)

    response = client.get(f"/api/collections/{collection.id}/assets/{relative}")

    assert response.status_code == 404


def test_a_traversal_path_is_not_served(
    client: TestClient, collection: models.Collection
) -> None:
    response = client.get(
        f"/api/collections/{collection.id}/assets/collections/{collection.id}/../../secret"
    )

    assert response.status_code == 404


def test_a_missing_asset_is_404(client: TestClient, collection: models.Collection) -> None:
    response = client.get(
        f"/api/collections/{collection.id}/assets/collections/{collection.id}/derived/x/y.png"
    )

    assert response.status_code == 404


def test_the_route_requires_auth(unauthed_client: TestClient) -> None:
    response = unauthed_client.get(
        f"/api/collections/{uuid4()}/assets/collections/{uuid4()}/derived/d/a.png"
    )

    assert response.status_code == 401


def test_a_dotdot_path_inside_the_storage_root_cannot_cross_scopes(
    client: TestClient, collection: models.Collection, session: Session, auth_user: models.User
) -> None:
    """Containment is decided on the resolved path, not a string prefix.

    `collections/<mine>/../<other>/…` passes a prefix test while resolving
    into another collection's directory — inside the storage root, so only
    scope containment can refuse it. Percent-encoded dots survive client
    and server URL normalization, which is what makes this reachable.
    """
    other = models.Collection(user_id=auth_user.id, name="Other2", description="", extra_metadata={})
    CollectionRepository(session).add(other)
    session.commit()
    session.refresh(other)
    relative = _store_asset(other.id)

    crafted = f"collections/{collection.id}/%2e%2e/{other.id}/derived/doc-1/page1-0.png"
    response = client.get(f"/api/collections/{collection.id}/assets/{crafted}")

    assert response.status_code == 404
    assert FileStorage().read_bytes(relative) == PNG_BYTES  # the asset exists; scope refused it
