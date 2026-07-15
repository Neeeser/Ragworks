"""Account service: registration, settings updates, and the base system prompt.

Owns the user-mutation behavior the auth and chat routes used to inline.
Provider credentials live on `provider_connections` (see
`app.services.connections`), not user columns, so settings updates here cover
only run-settings order and session persistence.
"""

from __future__ import annotations

import logging
from contextlib import suppress

from sqlmodel import Session

from app.core.security import hash_password
from app.db import models
from app.db.repositories import UserRepository
from app.schemas.auth import UserCreate, UserSettingsUpdate
from app.schemas.enums import UserRole
from app.services.errors import InvalidInputError
from app.services.pipelines import PipelineService
from app.telemetry import record
from app.telemetry.events import UserRegistered


class AccountService:
    """Register users and update their settings and prompt."""

    def __init__(self, session: Session) -> None:
        """Bind the service to a request-scoped session."""
        self.session = session
        self.repo = UserRepository(session)

    def register(self, payload: UserCreate) -> models.User:
        """Create a user with default pipelines, rejecting duplicate emails."""
        if self.repo.get_by_email(payload.email):
            raise InvalidInputError("Email already registered.")
        user = models.User(
            email=payload.email,
            full_name=payload.full_name,
            hashed_password=hash_password(payload.password),
            role=UserRole.ADMIN.value if self.repo.count() == 0 else UserRole.USER.value,
        )
        self.repo.add(user)
        # Best-effort scaffolding: on an install that hasn't completed
        # first-run setup there is no embedding model to build defaults
        # around — sign-up still succeeds and the wizard scaffolds later.
        with suppress(InvalidInputError):
            PipelineService(self.session).ensure_default_pipelines(user)
        self.session.commit()
        self.session.refresh(user)
        record(UserRegistered(user_id=user.id))
        return user

    def update_settings(
        self,
        user: models.User,
        payload: UserSettingsUpdate,
    ) -> models.User:
        """Apply run-settings order and session persistence for a user."""
        if payload.run_settings_order is not None:
            user.run_settings_order = [entry.value for entry in payload.run_settings_order]
        if payload.remember_session_days is not None:
            user.remember_session_days = payload.remember_session_days
        if payload.remember_hf_tokenizer_downloads is not None:
            user.remember_hf_tokenizer_downloads = payload.remember_hf_tokenizer_downloads
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user

    def update_base_prompt(self, user: models.User, template: str | None) -> models.User:
        """Persist a user's custom base system prompt (empty/blank clears it)."""
        normalized = (template or "").strip()
        user.system_prompt_template = normalized or None
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        return user


def ensure_admin_exists(session: Session) -> None:
    """Promote the earliest-created user to admin when no admin exists.

    Covers deployments that predate roles: without this, an upgraded install
    would have admin-only pages nobody can reach. No-op on empty databases and
    installs that already have an admin.
    """
    repo = UserRepository(session)
    if repo.count_admins() > 0:
        return
    earliest = repo.earliest_created()
    if earliest is None:
        return
    earliest.role = UserRole.ADMIN.value
    session.add(earliest)
    session.commit()
    logging.getLogger(__name__).warning(
        "No admin account existed; promoted earliest user %s to admin.", earliest.email
    )
