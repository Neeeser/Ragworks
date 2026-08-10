"""Aggregation over the usage ledger: units stay apart, dollars suppress.

Every case here drives `UsageReadService` against real Postgres, so the
`GROUP BY` and the cost-suppression `CASE` are the code under test rather
than a Python fold standing in for them.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import UsageEventRepository
from app.schemas.auth import UserCreate
from app.schemas.enums import UsageBucket, UsageGroupBy, UsageKind, UsageSurface, UsageUnit
from app.schemas.usage import UsageQuery
from app.services.accounts import AccountService
from app.services.errors import InvalidInputError
from app.services.usage import DEFAULT_RANGE_DAYS, UsageReadService, resolve_range

NOW = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)
RANGE = (NOW - timedelta(days=7), NOW + timedelta(days=1))


@pytest.fixture(name="user")
def user_fixture(session: Session) -> models.User:
    """A registered account the ledger rows are attributed to."""
    return AccountService(session).register(
        UserCreate(email=f"usage-{uuid4().hex}@example.com", password="password123")
    )


@pytest.fixture(name="other_user")
def other_user_fixture(session: Session) -> models.User:
    """A second account, so isolation is observable."""
    return AccountService(session).register(
        UserCreate(email=f"other-{uuid4().hex}@example.com", password="password123")
    )


def record(
    session: Session,
    user: models.User,
    *,
    model: str = "gpt-4o-mini",
    kind: UsageKind = UsageKind.CHAT,
    surface: UsageSurface = UsageSurface.CHAT,
    quantity: int = 100,
    unit: UsageUnit = UsageUnit.TOKENS,
    cost_usd: float | None = 0.01,
    created_at: datetime = NOW,
    connection_id: UUID | None = None,
) -> models.UsageEvent:
    """Append one ledger row at a chosen instant."""
    row = UsageEventRepository(session).add_event(
        user_id=user.id,
        connection_id=connection_id,
        provider="openrouter",
        model=model,
        kind=kind,
        surface=surface,
        quantity=quantity,
        unit=unit,
        cost_usd=cost_usd,
    )
    row.created_at = created_at
    session.add(row)
    session.commit()
    return row


def query(user: models.User | None = None) -> UsageQuery:
    """The default range, scoped to a user when one is given."""
    start, end = RANGE
    return UsageQuery(start=start, end=end, user_id=None if user is None else user.id)


def test_units_are_never_summed_together(session: Session, user: models.User) -> None:
    record(session, user, model="rerank-v3", quantity=40, unit=UsageUnit.TOKENS)
    record(session, user, model="rerank-v3", quantity=3, unit=UsageUnit.SEARCH_UNITS)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    by_unit = {row.unit: row for row in summary.groups if row.key == "rerank-v3"}
    assert by_unit[UsageUnit.TOKENS].quantity == 40
    assert by_unit[UsageUnit.SEARCH_UNITS].quantity == 3
    assert {total.unit for total in summary.totals} == {
        UsageUnit.TOKENS,
        UsageUnit.SEARCH_UNITS,
    }


def test_group_cost_is_suppressed_when_one_event_is_unpriced(
    session: Session, user: models.User
) -> None:
    record(session, user, model="mixed", quantity=100, cost_usd=0.5)
    record(session, user, model="mixed", quantity=100, cost_usd=None)
    record(session, user, model="priced", quantity=10, cost_usd=0.25)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    groups = {row.key: row for row in summary.groups}
    assert groups["mixed"].quantity == 200
    assert groups["mixed"].cost_usd is None
    assert groups["priced"].cost_usd == pytest.approx(0.25)
    assert summary.total_cost_usd is None


def test_an_unpriced_event_measuring_nothing_suppresses_nothing(
    session: Session, user: models.User
) -> None:
    record(session, user, model="zero", quantity=10, cost_usd=0.75)
    record(session, user, model="zero", quantity=0, cost_usd=None)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    assert summary.groups[0].cost_usd == pytest.approx(0.75)
    assert summary.total_cost_usd == pytest.approx(0.75)


def test_a_zero_price_is_a_real_price(session: Session, user: models.User) -> None:
    record(session, user, model="free", quantity=10, cost_usd=0.0)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    assert summary.groups[0].cost_usd == pytest.approx(0.0)
    assert summary.total_cost_usd == pytest.approx(0.0)


def test_series_buckets_by_day_and_stacks_by_kind(session: Session, user: models.User) -> None:
    record(session, user, kind=UsageKind.CHAT, quantity=10, created_at=NOW - timedelta(days=2))
    record(
        session,
        user,
        kind=UsageKind.EMBEDDING,
        quantity=20,
        created_at=NOW - timedelta(days=2, hours=3),
    )
    record(session, user, kind=UsageKind.CHAT, quantity=5, created_at=NOW)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.KIND, bucket=UsageBucket.DAY
    )

    assert [(point.kind, point.quantity) for point in summary.series] == [
        (UsageKind.CHAT, 10),
        (UsageKind.EMBEDDING, 20),
        (UsageKind.CHAT, 5),
    ]
    assert summary.series[0].bucket_start < summary.series[-1].bucket_start


def test_hour_buckets_split_a_day(session: Session, user: models.User) -> None:
    record(session, user, quantity=10, created_at=NOW - timedelta(hours=2))
    record(session, user, quantity=7, created_at=NOW)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.KIND, bucket=UsageBucket.HOUR
    )

    assert [point.quantity for point in summary.series] == [10, 7]


def test_series_cost_is_suppressed_per_bucket(session: Session, user: models.User) -> None:
    record(session, user, quantity=10, cost_usd=None, created_at=NOW - timedelta(days=1))
    record(session, user, quantity=10, cost_usd=0.4, created_at=NOW)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.KIND, bucket=UsageBucket.DAY
    )

    assert [point.cost_usd for point in summary.series] == [None, pytest.approx(0.4)]


def test_summary_never_counts_another_users_events(
    session: Session, user: models.User, other_user: models.User
) -> None:
    record(session, user, quantity=10)
    record(session, other_user, quantity=999)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    assert summary.totals[0].quantity == 10


def test_events_outside_the_range_are_excluded(session: Session, user: models.User) -> None:
    record(session, user, quantity=10, created_at=NOW - timedelta(days=30))
    record(session, user, quantity=4)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.MODEL, bucket=UsageBucket.DAY
    )

    assert summary.totals[0].quantity == 4


def test_connection_groups_carry_the_connection_label(
    session: Session, user: models.User
) -> None:
    connection = models.ProviderConnection(
        user_id=user.id,
        provider_type="openrouter",
        label="Work key",
        config={"api_key": "k"},
    )
    session.add(connection)
    session.commit()
    record(session, user, quantity=10, connection_id=connection.id)
    record(session, user, quantity=3, connection_id=None)

    summary = UsageReadService(session).summary(
        query(user), group_by=UsageGroupBy.CONNECTION, bucket=UsageBucket.DAY
    )

    rows = {row.key: row for row in summary.groups}
    assert rows[str(connection.id)].label == "Work key"
    assert rows[None].label is None


def test_user_groups_carry_the_account_email(
    session: Session, user: models.User, other_user: models.User
) -> None:
    record(session, user, quantity=10)
    record(session, other_user, quantity=20)

    summary = UsageReadService(session).summary(
        query(), group_by=UsageGroupBy.USER, bucket=UsageBucket.DAY
    )

    labels = {row.key: row.label for row in summary.groups}
    assert labels[str(user.id)] == user.email
    assert labels[str(other_user.id)] == other_user.email


def test_grouping_by_user_inside_one_users_range_is_refused(
    session: Session, user: models.User
) -> None:
    with pytest.raises(InvalidInputError):
        UsageReadService(session).summary(
            query(user), group_by=UsageGroupBy.USER, bucket=UsageBucket.DAY
        )


def test_events_page_is_newest_first_and_reports_the_full_total(
    session: Session, user: models.User
) -> None:
    for offset_hours in range(3):
        record(
            session,
            user,
            model=f"m{offset_hours}",
            created_at=NOW - timedelta(hours=offset_hours),
        )

    page = UsageReadService(session).events(query(user), limit=2, offset=0)

    assert [event.model for event in page.events] == ["m0", "m1"]
    assert page.total == 3
    assert page.limit == 2

    second = UsageReadService(session).events(query(user), limit=2, offset=2)
    assert [event.model for event in second.events] == ["m2"]


def test_events_apply_every_filter(session: Session, user: models.User) -> None:
    record(session, user, model="wanted", kind=UsageKind.EMBEDDING, surface=UsageSurface.INGESTION)
    record(session, user, model="other", kind=UsageKind.CHAT, surface=UsageSurface.CHAT)
    start, end = RANGE
    filtered = UsageQuery(
        start=start,
        end=end,
        user_id=user.id,
        kind=UsageKind.EMBEDDING,
        surface=UsageSurface.INGESTION,
        model="wanted",
    )

    page = UsageReadService(session).events(filtered, limit=50, offset=0)

    assert [event.model for event in page.events] == ["wanted"]
    assert page.total == 1


def test_default_range_covers_the_last_thirty_days() -> None:
    start, end = resolve_range(None, None)

    assert (end - start).days == DEFAULT_RANGE_DAYS


def test_a_backwards_range_is_refused() -> None:
    with pytest.raises(InvalidInputError):
        resolve_range(NOW, NOW - timedelta(days=1))


def test_a_bound_with_no_offset_is_read_as_utc() -> None:
    """`?start=2026-01-01T00:00:00` is a query string a user can type.

    Regression: FastAPI parses an offset-less datetime as naive while the
    defaults are timezone-aware, so comparing them raised `TypeError` — a
    500 the route's `except ServiceError` never saw.
    """
    naive = datetime(2026, 1, 1, 0, 0, 0)

    start, end = resolve_range(naive, None)

    assert start == naive.replace(tzinfo=UTC)
    assert start < end

    with pytest.raises(InvalidInputError):
        resolve_range(naive, naive - timedelta(days=1))
