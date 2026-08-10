"""Repository for the append-only usage ledger.

Writer only: aggregation queries belong to the surface that reads the ledger
and are added beside it, so a writer that never reads cannot grow a query
nothing calls.
"""

from __future__ import annotations

from uuid import UUID

from app.db import models
from app.db.repositories.base import Repository
from app.schemas.enums import UsageKind, UsageSurface, UsageUnit


class UsageEventRepository(Repository):
    """Data access for the append-only usage_events table."""

    def add_event(  # noqa: PLR0913 - one column per argument; the row is the contract
        self,
        *,
        user_id: UUID,
        connection_id: UUID | None,
        provider: str,
        model: str,
        kind: UsageKind,
        surface: UsageSurface,
        quantity: int,
        unit: UsageUnit,
        context_type: str | None = None,
        context_id: UUID | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        cost_usd: float | None = None,
    ) -> models.UsageEvent:
        """Append one usage row (flushed, not committed)."""
        return self._add(
            models.UsageEvent(
                user_id=user_id,
                connection_id=connection_id,
                provider=provider,
                model=model,
                kind=kind.value,
                surface=surface.value,
                context_type=context_type,
                context_id=context_id,
                quantity=quantity,
                unit=unit.value,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=cost_usd,
            )
        )
