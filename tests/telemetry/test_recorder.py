"""Behavior tests for telemetry recording: writes, kill switch, the
never-breaks-the-caller invariant, and retention purging."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import timedelta
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.db import models
from app.db.repositories import AppSettingRepository, TelemetryRepository, UserRepository
from app.services.app_config import invalidate_app_config_cache
from app.telemetry import purge_expired, record
from app.telemetry.events import ChatTurnCompleted, UserRegistered
from app.utils.time import utc_now


@pytest.fixture(autouse=True)
def _invalidate_cache() -> Iterator[None]:
    """Config flips in these tests must not leak through the process cache."""
    invalidate_app_config_cache()
    yield
    invalidate_app_config_cache()


def _make_user(session: Session) -> models.User:
    user = models.User(email=f"{uuid4()}@example.com", hashed_password="hashed")
    UserRepository(session).add(user)
    session.commit()
    session.refresh(user)
    return user


def test_record_writes_a_row_with_json_safe_payload(session: Session) -> None:
    user = _make_user(session)
    chat_session_id = uuid4()

    record(
        ChatTurnCompleted(
            user_id=user.id,
            session_id=chat_session_id,
            model="test/model",
            prompt_tokens=10,
            completion_tokens=20,
            total_tokens=30,
            cost=0.005,
        )
    )

    with Session(session.get_bind()) as fresh:
        rows = TelemetryRepository(fresh).list_by_type("chat.turn_completed")
    assert len(rows) == 1
    assert rows[0].user_id == user.id
    assert rows[0].payload["session_id"] == str(chat_session_id)
    assert rows[0].payload["total_tokens"] == 30
    # The discriminator and user_id live in columns, not the payload.
    assert "type" not in rows[0].payload
    assert "user_id" not in rows[0].payload


def test_kill_switch_suppresses_recording(session: Session) -> None:
    AppSettingRepository(session).upsert("telemetry.enabled", False, updated_by=None)
    session.commit()
    invalidate_app_config_cache()

    record(UserRegistered(user_id=None))

    with Session(session.get_bind()) as fresh:
        assert TelemetryRepository(fresh).list_by_type("user.registered") == []


def test_record_never_raises_into_its_caller(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from app.schemas.app_config import AppConfig
    from app.telemetry import recorder as recorder_module

    def _boom(self: TelemetryRepository, **_kwargs: object) -> None:
        raise RuntimeError("db down")

    # Pin the kill switch open without touching the DB: this test must fail
    # only if record() lets the repository error escape.
    monkeypatch.setattr(recorder_module, "get_app_config", AppConfig)
    monkeypatch.setattr(TelemetryRepository, "add", _boom)

    with caplog.at_level("WARNING", logger="app.telemetry.recorder"):
        record(UserRegistered(user_id=None))  # must not raise

    assert any("Telemetry recording failed" in message for message in caplog.messages)


def test_purge_expired_deletes_only_rows_past_retention(session: Session) -> None:
    repo = TelemetryRepository(session)
    old = repo.add(event_type="user.signed_in", user_id=None, payload={})
    old.created_at = utc_now() - timedelta(days=91)
    session.add(old)
    repo.add(event_type="user.signed_in", user_id=None, payload={})
    session.commit()

    purged = purge_expired()

    assert purged == 1
    with Session(session.get_bind()) as fresh:
        remaining = TelemetryRepository(fresh).list_by_type("user.signed_in")
    assert len(remaining) == 1
