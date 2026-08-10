"""Who a provider call belongs to, carried to the boundary that measures it.

The provider boundary knows the connection, the model, and the tokens; it
cannot know which user's ingestion run or chat turn it is serving. The call
site that owns the request or job opens a scope, and the capture point reads
it — with no scope open nothing is recorded, because a guessed attribution
is worse than a missing row.

This module sits below both `app/services` and `app/pipelines`, so the
engine reads it without importing services.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from uuid import UUID

from app.schemas.enums import UsageSurface


@dataclass(frozen=True)
class UsageScope:
    """The attribution a provider call inherits from its caller.

    `connection_id` and `provider` are the scope's fallbacks: a job running
    several connections leaves them unset and the capture point supplies the
    connection it actually called.
    """

    user_id: UUID
    surface: UsageSurface
    connection_id: UUID | None = None
    provider: str | None = None
    context_type: str | None = None
    context_id: UUID | None = None


_scope: ContextVar[UsageScope | None] = ContextVar("usage_scope", default=None)


def current_usage_scope() -> UsageScope | None:
    """The scope open on this context, or None when nothing set one."""
    return _scope.get()


@contextmanager
def usage_scope(
    user_id: UUID,
    surface: UsageSurface | None = None,
    *,
    connection_id: UUID | None = None,
    provider: str | None = None,
    context_type: str | None = None,
    context_id: UUID | None = None,
) -> Iterator[UsageScope]:
    """Attribute every provider call made inside the block.

    An inner scope inherits the surface of the one it nests in when it names
    none: a retrieval pipeline run is `chat` when a chat turn opened it and
    `eval_run` under an eval, and the pipeline runner does not know which.
    """
    outer = _scope.get()
    if outer is None:
        if surface is None:
            raise ValueError("The outermost usage scope must name a surface.")
        scope = UsageScope(
            user_id=user_id,
            surface=surface,
            connection_id=connection_id,
            provider=provider,
            context_type=context_type,
            context_id=context_id,
        )
    else:
        scope = replace(
            outer,
            user_id=user_id,
            surface=surface or outer.surface,
            connection_id=connection_id or outer.connection_id,
            provider=provider or outer.provider,
            context_type=context_type or outer.context_type,
            context_id=context_id or outer.context_id,
        )
    token = _scope.set(scope)
    try:
        yield scope
    finally:
        _scope.reset(token)
