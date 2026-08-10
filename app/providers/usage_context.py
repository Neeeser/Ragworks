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

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
from dataclasses import dataclass, replace
from typing import TypeVar
from uuid import UUID

from app.schemas.enums import UsageSurface


@dataclass(frozen=True)
class UsageScope:
    """The attribution a provider call inherits from its caller.

    The connection and model are deliberately absent: one job calls several
    connections, and the boundary that made the call is the only place that
    knows which one it was.
    """

    user_id: UUID
    surface: UsageSurface
    context_type: str | None = None
    context_id: UUID | None = None


_scope: ContextVar[UsageScope | None] = ContextVar("usage_scope", default=None)

T = TypeVar("T")


def current_usage_scope() -> UsageScope | None:
    """The scope open on this context, or None when nothing set one."""
    return _scope.get()


@contextmanager
def usage_scope(
    user_id: UUID,
    surface: UsageSurface,
    *,
    context_type: str | None = None,
    context_id: UUID | None = None,
) -> Iterator[UsageScope]:
    """Attribute every provider call made inside the block.

    The merge rule, in full:

    - No scope open, or one open for a *different* user: this scope is used
      as given. A nested scope naming another user is a different owner's
      work, so inheriting the outer surface would bill one user's spend
      under the other's activity.
    - A scope already open for the same user: `surface` is ignored and the
      outer one kept; `context_type`/`context_id` are refined when given.
      A retrieval pipeline run is `chat` when a chat turn opened it and
      `eval_run` under an eval, and the runner cannot tell which — so it
      states what it would be on its own and is overruled by whoever asked
      for the run.
    """
    outer = _scope.get()
    if outer is None or outer.user_id != user_id:
        scope = UsageScope(
            user_id=user_id,
            surface=surface,
            context_type=context_type,
            context_id=context_id,
        )
    else:
        scope = replace(
            outer,
            context_type=context_type or outer.context_type,
            context_id=context_id or outer.context_id,
        )
    token = _scope.set(scope)
    try:
        yield scope
    finally:
        _scope.reset(token)


def iterate_in_usage_scope(
    items: Callable[[], Iterator[T]],
    user_id: UUID,
    surface: UsageSurface,
    *,
    context_type: str | None = None,
    context_id: UUID | None = None,
) -> Iterator[T]:
    """Yield from `items()` with a usage scope that survives per-step contexts.

    A `with usage_scope(...)` inside a generator only holds while the
    generator's frame is running, and the frame runs in whatever context the
    consumer supplies. Starlette drives a *sync* generator response through
    `iterate_in_threadpool`, which copies the context afresh for each
    `next()` — so the scope set on one step is gone by the next one, and the
    `finally` reset raises `ValueError: Token was created in a different
    Context` during teardown. Driving every step inside one `Context` we own
    makes the scope outlive the steps, whoever is calling `next`.
    """
    context = copy_context()
    context.run(
        _scope.set,
        UsageScope(
            user_id=user_id,
            surface=surface,
            context_type=context_type,
            context_id=context_id,
        ),
    )
    iterator = context.run(items)
    try:
        while True:
            try:
                item = context.run(next, iterator)
            except StopIteration:
                return
            yield item
    finally:
        close = getattr(iterator, "close", None)
        if close is not None:
            context.run(close)
