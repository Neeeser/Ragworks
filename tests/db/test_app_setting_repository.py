"""Behavior tests for AppSettingRepository: override storage round-trips."""

from __future__ import annotations

from sqlmodel import Session

from app.db.repositories import AppSettingRepository


def test_upsert_insert_update_and_read_back(session: Session) -> None:
    repo = AppSettingRepository(session)
    repo.upsert("uploads.max_upload_size_mb", 10, updated_by=None)
    repo.upsert("uploads.max_upload_size_mb", 25, updated_by=None)  # update path
    repo.upsert("auth.allow_registration", False, updated_by=None)
    session.commit()

    with Session(session.get_bind()) as fresh:
        overrides = AppSettingRepository(fresh).all_overrides()
    assert overrides == {
        "uploads.max_upload_size_mb": 25,
        "auth.allow_registration": False,
        # Seeded by every test session (see tests/utils/db.py).
    }


def test_delete_clears_an_override_and_tolerates_absence(session: Session) -> None:
    repo = AppSettingRepository(session)
    repo.upsert("features.chat_branching", False, updated_by=None)
    session.commit()
    repo.delete("features.chat_branching")
    repo.delete("features.chat_branching")  # second delete: no-op, no error
    session.commit()

    with Session(session.get_bind()) as fresh:
        assert AppSettingRepository(fresh).all_overrides() == {
            }
