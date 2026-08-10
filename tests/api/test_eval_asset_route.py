"""HTTP contract for the eval dataset asset route.

Dataset records carry a storage-relative media path (`eval_datasets/{id}/…`);
this route is how the client fetches the bytes to render a thumbnail. The
contract worth pinning is the authorization boundary: the path must live
under the requested dataset's own directory, and the dataset must be the
caller's.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import UserRepository
from app.utils.file_storage import FileStorage

PNG_BYTES = b"\x89PNG\r\n\x1a\n-test-bytes"


def _dataset(session: Session, user: models.User, name: str = "Images") -> models.EvalDataset:
    dataset = models.EvalDataset(user_id=user.id, name=name, source="upload", status="ready")
    session.add(dataset)
    session.commit()
    session.refresh(dataset)
    return dataset


@pytest.fixture(name="dataset")
def dataset_fixture(session: Session, auth_user: models.User) -> models.EvalDataset:
    return _dataset(session, auth_user)


def _store_media(dataset_id: UUID) -> str:
    relative = f"eval_datasets/{dataset_id}/queries/q1.png"
    FileStorage().write_bytes(PNG_BYTES, relative)
    return relative


def test_media_streams_with_its_media_type(
    client: TestClient, dataset: models.EvalDataset
) -> None:
    relative = _store_media(dataset.id)

    response = client.get(f"/api/evals/datasets/{dataset.id}/assets/{relative}")

    assert response.status_code == 200
    assert response.content == PNG_BYTES
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_a_path_into_another_dataset_is_not_served(
    client: TestClient, dataset: models.EvalDataset, session: Session, auth_user: models.User
) -> None:
    """Owning one dataset never reads another's directory."""
    other = _dataset(session, auth_user, name="Other")
    relative = _store_media(other.id)

    response = client.get(f"/api/evals/datasets/{dataset.id}/assets/{relative}")

    assert response.status_code == 404


def test_another_users_dataset_is_not_served(client: TestClient, session: Session) -> None:
    """A dataset the caller does not own answers exactly like a missing one."""
    stranger = models.User(email="stranger@example.com", full_name="S", hashed_password="h")
    UserRepository(session).add(stranger)
    session.commit()
    session.refresh(stranger)
    theirs = _dataset(session, stranger, name="Theirs")
    relative = _store_media(theirs.id)

    response = client.get(f"/api/evals/datasets/{theirs.id}/assets/{relative}")

    assert response.status_code == 404
    assert FileStorage().read_bytes(relative) == PNG_BYTES  # it exists; ownership refused it


def test_a_missing_asset_is_404(client: TestClient, dataset: models.EvalDataset) -> None:
    response = client.get(
        f"/api/evals/datasets/{dataset.id}/assets/eval_datasets/{dataset.id}/queries/gone.png"
    )

    assert response.status_code == 404


def test_a_dotdot_path_inside_the_storage_root_cannot_cross_scopes(
    client: TestClient, dataset: models.EvalDataset, session: Session, auth_user: models.User
) -> None:
    """Containment is decided on the resolved path, not a string prefix."""
    other = _dataset(session, auth_user, name="Other2")
    relative = _store_media(other.id)

    crafted = f"eval_datasets/{dataset.id}/%2e%2e/{other.id}/queries/q1.png"
    response = client.get(f"/api/evals/datasets/{dataset.id}/assets/{crafted}")

    assert response.status_code == 404
    assert FileStorage().read_bytes(relative) == PNG_BYTES


def test_the_route_requires_auth(unauthed_client: TestClient) -> None:
    dataset_id = uuid4()
    response = unauthed_client.get(
        f"/api/evals/datasets/{dataset_id}/assets/eval_datasets/{dataset_id}/queries/q1.png"
    )

    assert response.status_code == 401
