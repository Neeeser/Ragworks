"""Behavior of the account service: registration, settings, and base prompt.

These migrated out of ``tests/api/test_auth_routes.py`` when Task 6.2 moved the
behavior off the route and into ``AccountService`` -- the route now only
translates the domain errors these tests raise. Provider credentials live on
``provider_connections`` (see ``tests/services/test_connections.py``), so the
settings surface here covers run-settings order and the base prompt only.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.db import models
from app.db.repositories import UserRepository
from app.schemas.auth import RunSettingsSection, UserCreate, UserSettingsUpdate
from app.schemas.enums import UserRole
from app.services.accounts import AccountService, ensure_admin_exists
from app.services.errors import InvalidInputError


def _persist_user(session: Session) -> models.User:
    user = models.User(email="user@example.com", full_name="User", hashed_password="hashed")
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_register_rejects_duplicate_email(session: Session) -> None:
    payload = UserCreate(email="user@example.com", full_name="User", password="Str0ngPass!")
    AccountService(session).register(payload)

    with pytest.raises(InvalidInputError):
        AccountService(session).register(payload)


def test_new_user_defaults_to_user_role(session: Session) -> None:
    """A freshly registered account (after the first) carries the non-privileged role."""
    service = AccountService(session)
    service.register(UserCreate(email="admin-seed@example.com", password="password123"))
    user = service.register(
        UserCreate(email="role-default@example.com", password="password123")
    )
    with Session(session.get_bind()) as fresh_session:
        fresh = fresh_session.get(models.User, user.id)
        assert fresh is not None
        assert fresh.role == UserRole.USER.value


def test_register_creates_no_pipelines(session: Session) -> None:
    """Sign-up never depends on, or produces, setup state.

    Registration builds no pipelines: which graph a user runs is a choice they
    make in the setup wizard around an explicit embedding model, so an account
    created before that starts empty rather than holding a pair built around a
    model nobody picked.
    """
    user = AccountService(session).register(
        UserCreate(email="new@example.com", full_name="New", password="Str0ngPass!")
    )
    assert user.id is not None
    assert session.exec(
        select(models.Pipeline).where(models.Pipeline.user_id == user.id)
    ).all() == []


def test_update_settings_sets_run_settings_order(session: Session) -> None:
    user = _persist_user(session)
    order = [
        RunSettingsSection.STREAMING,
        RunSettingsSection.SYSTEM_PROMPT,
        RunSettingsSection.USAGE,
    ]

    AccountService(session).update_settings(user, UserSettingsUpdate(run_settings_order=order))

    session.refresh(user)
    assert user.run_settings_order == [entry.value for entry in order]


def test_set_base_prompt_points_at_a_library_prompt(session: Session) -> None:
    from app.schemas.enums import PromptContext
    from app.schemas.prompts import PromptCreate, PromptReference
    from app.services.prompts.library import PromptLibraryService

    user = _persist_user(session)
    prompt = PromptLibraryService(session).create(
        user.id,
        PromptCreate(name="Alt base", context=PromptContext.CHAT_BASE, body="Hi {{user.email}}"),
    )
    session.commit()

    AccountService(session).set_base_prompt(
        user, PromptReference(prompt_id=prompt.id, version=1)
    )
    session.refresh(user)
    assert user.base_prompt_id == prompt.id
    assert user.base_prompt_version == 1
    assert user.system_prompt_template is None


def test_first_registered_user_becomes_admin(session: Session) -> None:
    """On an empty install the first account is the admin; the second is not."""
    service = AccountService(session)
    first = service.register(UserCreate(email="first@example.com", password="password123"))
    second = service.register(UserCreate(email="second@example.com", password="password123"))
    with Session(session.get_bind()) as fresh:
        assert fresh.get(models.User, first.id).role == UserRole.ADMIN.value
        assert fresh.get(models.User, second.id).role == UserRole.USER.value


def test_ensure_admin_exists_promotes_earliest_user(session: Session) -> None:
    """Upgraded deployments with users but no admin promote the earliest account."""
    service = AccountService(session)
    first = service.register(UserCreate(email="old@example.com", password="password123"))
    service.register(UserCreate(email="new@example.com", password="password123"))
    # Simulate a pre-roles deployment: nobody is admin.
    for user in UserRepository(session).list_all():
        user.role = UserRole.USER.value
        session.add(user)
    session.commit()

    ensure_admin_exists(session)

    with Session(session.get_bind()) as fresh:
        assert fresh.get(models.User, first.id).role == UserRole.ADMIN.value


def test_ensure_admin_exists_is_a_noop_with_admin_or_no_users(session: Session) -> None:
    """No promotion happens when an admin already exists or the table is empty."""
    ensure_admin_exists(session)  # empty table: must not raise
    service = AccountService(session)
    admin = service.register(UserCreate(email="a@example.com", password="password123"))
    other = service.register(UserCreate(email="b@example.com", password="password123"))
    ensure_admin_exists(session)
    with Session(session.get_bind()) as fresh:
        assert fresh.get(models.User, admin.id).role == UserRole.ADMIN.value
        assert fresh.get(models.User, other.id).role == UserRole.USER.value
