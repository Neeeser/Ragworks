"""HTTP contract for /api/usage/* and the admin ledger rollup.

The contracts worth pinning here are the ones only the HTTP layer has: auth
gating, admin gating, per-user isolation, query-parameter validation, and
paging.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.db import models
from app.db.repositories import UsageEventRepository
from app.schemas.auth import UserCreate
from app.schemas.enums import UsageKind, UsageSurface, UsageUnit, UserRole
from app.services.accounts import AccountService

USER_SUMMARY = "/api/usage/summary"
USER_EVENTS = "/api/usage/events"
ADMIN_SUMMARY = "/api/admin/usage/ledger/summary"
ADMIN_EVENTS = "/api/admin/usage/ledger/events"


def _promote(session: Session, user: models.User) -> None:
    user.role = UserRole.ADMIN.value
    session.add(user)
    session.commit()
    session.refresh(user)


def _record(
    session: Session,
    user: models.User,
    *,
    model: str = "gpt-4o-mini",
    quantity: int = 100,
    cost_usd: float | None = 0.01,
    created_at: datetime | None = None,
) -> models.UsageEvent:
    row = UsageEventRepository(session).add_event(
        user_id=user.id,
        connection_id=None,
        provider="openrouter",
        model=model,
        kind=UsageKind.CHAT,
        surface=UsageSurface.CHAT,
        quantity=quantity,
        unit=UsageUnit.TOKENS,
        cost_usd=cost_usd,
    )
    if created_at is not None:
        row.created_at = created_at
        session.add(row)
    session.commit()
    return row


@pytest.fixture(name="stranger")
def stranger_fixture(session: Session) -> models.User:
    """A second account whose usage the authenticated caller must never see."""
    return AccountService(session).register(
        UserCreate(email=f"stranger-{uuid4().hex}@example.com", password="password123")
    )


@pytest.mark.parametrize("path", [USER_SUMMARY, USER_EVENTS, ADMIN_SUMMARY, ADMIN_EVENTS])
def test_usage_routes_require_a_token(unauthed_client: TestClient, path: str) -> None:
    assert unauthed_client.get(path).status_code == 401


@pytest.mark.parametrize("path", [ADMIN_SUMMARY, ADMIN_EVENTS])
def test_admin_ledger_routes_reject_non_admins(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 403


def test_summary_serves_the_callers_own_usage(
    client: TestClient, session: Session, auth_user: models.User, stranger: models.User
) -> None:
    _record(session, auth_user, model="mine", quantity=42)
    _record(session, stranger, model="theirs", quantity=999)

    body = client.get(USER_SUMMARY).json()

    assert [row["key"] for row in body["groups"]] == ["mine"]
    assert body["groups"][0]["unit"] == "tokens"
    assert body["totals"][0]["quantity"] == 42
    assert body["group_by"] == "model"
    assert body["bucket"] == "day"


def test_events_never_list_another_users_rows(
    client: TestClient, session: Session, auth_user: models.User, stranger: models.User
) -> None:
    _record(session, auth_user, model="mine")
    _record(session, stranger, model="theirs")

    body = client.get(USER_EVENTS).json()

    assert [event["model"] for event in body["events"]] == ["mine"]
    assert body["total"] == 1
    assert body["events"][0]["user_id"] == str(auth_user.id)


def test_events_page_through_the_range(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    now = datetime.now(UTC)
    for index in range(3):
        _record(session, auth_user, model=f"m{index}", created_at=now - timedelta(hours=index))

    first = client.get(USER_EVENTS, params={"limit": 2}).json()
    second = client.get(USER_EVENTS, params={"limit": 2, "offset": 2}).json()

    assert [event["model"] for event in first["events"]] == ["m0", "m1"]
    assert [event["model"] for event in second["events"]] == ["m2"]
    assert first["total"] == second["total"] == 3


def test_a_limit_above_the_cap_is_rejected(client: TestClient) -> None:
    assert client.get(USER_EVENTS, params={"limit": 201}).status_code == 422


def test_an_unknown_group_by_is_rejected(client: TestClient) -> None:
    assert client.get(USER_SUMMARY, params={"group_by": "collection"}).status_code == 422


def test_grouping_a_single_account_by_user_is_a_bad_request(client: TestClient) -> None:
    assert client.get(USER_SUMMARY, params={"group_by": "user"}).status_code == 400


def test_a_backwards_range_is_a_bad_request(client: TestClient) -> None:
    now = datetime.now(UTC)
    response = client.get(
        USER_SUMMARY,
        params={"start": now.isoformat(), "end": (now - timedelta(days=1)).isoformat()},
    )

    assert response.status_code == 400


def test_admin_summary_groups_every_account_by_user(
    client: TestClient, session: Session, auth_user: models.User, stranger: models.User
) -> None:
    _promote(session, auth_user)
    _record(session, auth_user, quantity=10)
    _record(session, stranger, quantity=20)

    body = client.get(ADMIN_SUMMARY, params={"group_by": "user"}).json()

    labels = {row["key"]: row["label"] for row in body["groups"]}
    assert labels[str(auth_user.id)] == auth_user.email
    assert labels[str(stranger.id)] == stranger.email


def test_admin_events_filter_to_one_user(
    client: TestClient, session: Session, auth_user: models.User, stranger: models.User
) -> None:
    _promote(session, auth_user)
    _record(session, auth_user, model="mine")
    _record(session, stranger, model="theirs")

    body = client.get(ADMIN_EVENTS, params={"user_id": str(stranger.id)}).json()

    assert [event["model"] for event in body["events"]] == ["theirs"]
    assert body["events"][0]["user_id"] == str(stranger.id)


def test_admin_events_span_every_account_unfiltered(
    client: TestClient, session: Session, auth_user: models.User, stranger: models.User
) -> None:
    _promote(session, auth_user)
    _record(session, auth_user, model="mine")
    _record(session, stranger, model="theirs")

    body = client.get(ADMIN_EVENTS).json()

    assert {event["model"] for event in body["events"]} == {"mine", "theirs"}


def test_an_unpriced_event_leaves_the_total_cost_null(
    client: TestClient, session: Session, auth_user: models.User
) -> None:
    _record(session, auth_user, quantity=10, cost_usd=0.5)
    _record(session, auth_user, quantity=10, cost_usd=None)

    body = client.get(USER_SUMMARY).json()

    assert body["total_cost_usd"] is None
