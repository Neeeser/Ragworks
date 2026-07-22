"""The mutable context a scenario seeds into.

Builders record what they created both as typed attributes (for composition
between builders/scenarios) and as `facts` — ordered human-readable lines the
CLI prints in the handoff block so an agent knows exactly what exists without
exploring.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlmodel import Session

from app.db import models


@dataclass
class SeedContext:
    """State threaded through a scenario's builders."""

    session: Session
    user: models.User | None = None
    token: str | None = None
    connection: models.ProviderConnection | None = None
    collection: models.Collection | None = None
    facts: list[str] = field(default_factory=list)
    links: list[tuple[str, str]] = field(default_factory=list)
    """(label, frontend path) deep links to seeded objects, printed in the
    handoff so a browser session can jump straight to the feature under test."""

    def require_user(self) -> models.User:
        """The seeded user; builders that need one call this to fail clearly."""
        if self.user is None:
            raise RuntimeError("This builder needs a seeded user — call create_admin_user first.")
        return self.user

    def require_connection(self) -> models.ProviderConnection:
        """The seeded provider connection, or a clear ordering error."""
        if self.connection is None:
            raise RuntimeError(
                "This builder needs a provider connection — call add_openrouter_connection first."
            )
        return self.connection

    def require_collection(self) -> models.Collection:
        """The seeded collection, or a clear ordering error."""
        if self.collection is None:
            raise RuntimeError(
                "This builder needs a collection — call bootstrap_setup first."
            )
        return self.collection
