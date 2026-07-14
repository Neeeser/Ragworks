"""Telemetry hooks fire at the instrumented sites.

Each test drives the real entry point and asserts the event row landed —
deleting a ``record(...)`` call at one of these sites fails its test. The
chat-turn hook is covered in ``tests/chat/test_chat_service_flow.py`` and the
sign-in hook in ``tests/api/test_auth_routes.py``, next to their harnesses;
the ingestion/retrieval hooks share the same one-line-after-commit placement
and the recorder's own behavior is pinned in ``test_recorder.py``.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlmodel import Session

from app.db.repositories import TelemetryRepository
from app.schemas.auth import UserCreate
from app.schemas.collections import CollectionCreate
from app.services.accounts import AccountService
from app.services.app_config import invalidate_app_config_cache
from app.services.collections import CollectionService
from tests.utils.providers import install_default_pipelines


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def test_registration_records_a_user_registered_event(session: Session) -> None:
    user = AccountService(session).register(
        UserCreate(email="telemetry-reg@example.com", password="password123")
    )

    with Session(session.get_bind()) as fresh:
        rows = TelemetryRepository(fresh).list_by_type("user.registered")
    assert [row.user_id for row in rows] == [user.id]


def test_collection_create_records_an_event(session: Session) -> None:
    user = AccountService(session).register(
        UserCreate(email="telemetry-coll@example.com", password="password123")
    )
    install_default_pipelines(session, user)

    collection = CollectionService(session).create(user, CollectionCreate(name="Notes"))

    with Session(session.get_bind()) as fresh:
        rows = TelemetryRepository(fresh).list_by_type("collection.created")
    assert len(rows) == 1
    assert rows[0].user_id == user.id
    assert rows[0].payload["collection_id"] == str(collection.id)
