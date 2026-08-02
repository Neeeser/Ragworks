"""Per-user model shortlists: pin a model, or record that one was used.

The shortlist is what the model pickers open on, so it has one job the catalog
cannot do: name the handful of models this user actually works with. Pins are
explicit and unbounded within reason; recents are written on every selection
and pruned to a cap, because a recents list longer than a screen stops being a
shortcut.
"""

from __future__ import annotations

from uuid import UUID

from sqlmodel import Session

from app.db import models
from app.db.repositories import ModelShortlistRepository, ProviderConnectionRepository
from app.schemas.enums import ProviderKind, ShortlistEntryType
from app.schemas.model_shortlist import (
    ModelShortlistEntry,
    ModelShortlistIdentity,
    ModelShortlistResponse,
)
from app.services.errors import NotFoundError
from app.utils.time import utc_now

#: How many recents a user keeps per model kind. A recents section is a fast
#: path, not a history: past this the oldest entries are pruned on write.
RECENTS_LIMIT = 8


class ModelShortlistService:
    """Reads and writes one user's pinned and recently used models."""

    def __init__(self, session: Session) -> None:
        """Initialize the service with a database session."""
        self.session = session
        self.repository = ModelShortlistRepository(session)
        self.connections = ProviderConnectionRepository(session)

    def list_shortlist(self, user: models.User, kind: ProviderKind) -> ModelShortlistResponse:
        """Return the user's pinned and recent models for one kind."""
        entries = self.repository.list_for_user(user.id, kind)
        return ModelShortlistResponse(
            pinned=[
                ModelShortlistEntry.model_validate(entry)
                for entry in entries
                if entry.entry_type == ShortlistEntryType.PINNED
            ],
            recent=[
                ModelShortlistEntry.model_validate(entry)
                for entry in entries
                if entry.entry_type == ShortlistEntryType.RECENT
            ],
        )

    def pin(self, user: models.User, identity: ModelShortlistIdentity) -> ModelShortlistEntry:
        """Pin a model, or return the existing pin unchanged.

        Pinning is idempotent: a second pin of the same model is the same
        state, and reporting it as a conflict would make a double-click an
        error the user has to understand.
        """
        self._require_connection(user, identity.connection_id)
        existing = self.repository.get(
            user_id=user.id,
            kind=identity.kind,
            entry_type=ShortlistEntryType.PINNED,
            connection_id=identity.connection_id,
            model_id=identity.model_id,
        )
        if existing is not None:
            return ModelShortlistEntry.model_validate(existing)
        entry = self.repository.create(
            user_id=user.id,
            kind=identity.kind,
            entry_type=ShortlistEntryType.PINNED,
            connection_id=identity.connection_id,
            model_id=identity.model_id,
        )
        self.session.commit()
        self.session.refresh(entry)
        return ModelShortlistEntry.model_validate(entry)

    def unpin(self, user: models.User, identity: ModelShortlistIdentity) -> None:
        """Remove a pin. Unpinning something unpinned is a no-op, not a 404.

        The end state the caller asked for is the state they get either way,
        and a star toggled twice must not surface an error.
        """
        existing = self.repository.get(
            user_id=user.id,
            kind=identity.kind,
            entry_type=ShortlistEntryType.PINNED,
            connection_id=identity.connection_id,
            model_id=identity.model_id,
        )
        if existing is None:
            return
        self.repository.delete(existing)
        self.session.commit()

    def record_use(
        self, user: models.User, identity: ModelShortlistIdentity
    ) -> ModelShortlistEntry:
        """Record that a model was selected, bumping it to the top of recents."""
        self._require_connection(user, identity.connection_id)
        now = utc_now()
        existing = self.repository.get(
            user_id=user.id,
            kind=identity.kind,
            entry_type=ShortlistEntryType.RECENT,
            connection_id=identity.connection_id,
            model_id=identity.model_id,
        )
        if existing is not None:
            existing.last_used_at = now
            self.session.add(existing)
            entry = existing
        else:
            entry = self.repository.create(
                user_id=user.id,
                kind=identity.kind,
                entry_type=ShortlistEntryType.RECENT,
                connection_id=identity.connection_id,
                model_id=identity.model_id,
                last_used_at=now,
            )
        self._prune_recents(user.id, identity.kind)
        self.session.commit()
        self.session.refresh(entry)
        return ModelShortlistEntry.model_validate(entry)

    def _prune_recents(self, user_id: UUID, kind: ProviderKind) -> None:
        """Drop the oldest recents past `RECENTS_LIMIT`."""
        self.session.flush()
        recents = self.repository.list_of_type(user_id, kind, ShortlistEntryType.RECENT)
        if len(recents) <= RECENTS_LIMIT:
            return
        self.repository.delete_ids([entry.id for entry in recents[RECENTS_LIMIT:]])

    def _require_connection(self, user: models.User, connection_id: UUID) -> None:
        """Reject a shortlist entry naming a connection the user does not own."""
        if self.connections.get_owned(connection_id, user.id) is None:
            raise NotFoundError("Provider connection not found")
