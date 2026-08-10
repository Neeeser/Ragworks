"""Recording what a provider call spent, at the boundary that made it.

The rule this module owns: recording never breaks the call being measured.
`UsageReporter.record` opens its own short `session_scope()` after the call
has already returned and swallows any failure with a logged warning — the
same deliberate, documented exception to the never-swallow rule the
telemetry recorder makes, and for the same reason.

Two facts are needed to write a row and neither side has both: the caller
knows the user and surface (`app/providers/usage_context.py`), the boundary
knows the connection, model, and quantity. A call with no scope open records
nothing rather than guessing an owner.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from typing import Any, TypeAlias
from uuid import UUID

from app.db.engine import session_scope
from app.db.repositories import UsageEventRepository
from app.providers.base import ProviderAdapter
from app.providers.chat.base import (
    ChatProvider,
    ChatRequest,
    ParsedChatResponse,
    ParsedStreamChunk,
)
from app.providers.pricing import catalog_pricing, usd_cost
from app.providers.usage_context import current_usage_scope
from app.schemas.enums import ProviderKind, UsageKind, UsageUnit
from app.schemas.models import ModelInfo, ModelPricing
from app.schemas.usage import MeasuredUsage, UsageSummary, usage_from_summary

logger = logging.getLogger(__name__)

#: Resolves a model's published per-token price, called at most once per
#: reporter and only after a call actually reported usage.
PricingLookup: TypeAlias = Callable[[], "ModelPricing | None"]


class UsageReporter:
    """Writes one connection-and-model's calls into the usage ledger.

    Built where the connection is resolved, so pricing is looked up from the
    adapter's cached catalog **once** per reporter and every later call is
    arithmetic. The lookup is deferred until a call actually reports usage:
    a run whose caller opened no scope must not pay for a catalog fetch.
    """

    def __init__(
        self,
        *,
        kind: UsageKind,
        provider: str,
        model: str,
        connection_id: UUID,
        pricing_lookup: PricingLookup,
    ) -> None:
        """Bind the reporter to one connection, model, and call kind."""
        self._kind = kind
        self._provider = provider
        self._model = model
        self._connection_id = connection_id
        self._pricing_lookup = pricing_lookup
        self._pricing: ModelPricing | None = None
        self._pricing_resolved = False

    def record(self, usage: MeasuredUsage | None) -> None:
        """Append one ledger row for a call that reported a quantity."""
        if usage is None:
            return
        scope = current_usage_scope()
        if scope is None:
            return
        try:
            with session_scope() as session:
                UsageEventRepository(session).add_event(
                    user_id=scope.user_id,
                    connection_id=self._connection_id,
                    provider=self._provider,
                    model=self._model,
                    kind=self._kind,
                    surface=scope.surface,
                    quantity=usage.quantity,
                    unit=usage.unit,
                    context_type=scope.context_type,
                    context_id=scope.context_id,
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    cost_usd=self._cost(usage),
                )
        except Exception:
            logger.warning("Usage ledger write failed for %s", self._model, exc_info=True)

    def _cost(self, usage: MeasuredUsage) -> float | None:
        """Dollars for one call: the provider's own figure, else the catalog's.

        A provider stating its cost is believed over a catalog price; one
        publishing neither leaves `cost_usd` null with the tokens intact.
        """
        if usage.reported_cost is not None:
            return usage.reported_cost
        if usage.unit is not UsageUnit.TOKENS:
            return None
        return usd_cost(
            self._resolve_pricing(),
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
        )

    def _resolve_pricing(self) -> ModelPricing | None:
        """The model's published per-token price, looked up at most once."""
        if not self._pricing_resolved:
            self._pricing_resolved = True
            try:
                self._pricing = self._pricing_lookup()
            except Exception:
                # An unpriceable call still records its tokens, but a catalog
                # that is permanently broken nulls every cost silently — so
                # this is operator-visible, not a debug line.
                logger.warning(
                    "Usage ledger pricing unavailable for %s", self._model, exc_info=True
                )
                self._pricing = None
        return self._pricing


class UsageCapturingChatProvider:
    """A chat provider that records what each completed call reported.

    Every chat surface — interactive sessions, the prompt studio, LLM
    pipeline nodes, eval generation — reaches its model through one of these,
    so the ledger sees each provider call exactly once and the surface comes
    from the scope its caller opened. Streaming records when the stream ends:
    usage arrives in the final chunks, and a turn the client abandoned still
    spent whatever the provider had already reported.
    """

    def __init__(self, inner: ChatProvider, reporter_for: Callable[[str], UsageReporter]) -> None:
        """Wrap `inner`, building a reporter per model the caller requests."""
        self._inner = inner
        self._reporter_for = reporter_for
        self._reporters: dict[str, UsageReporter] = {}
        # Plain attribute: the ChatProvider protocol declares a settable name.
        self.name = inner.name

    def get_model(self, model_id: str) -> ModelInfo | None:
        """Return provider model metadata when available."""
        return self._inner.get_model(model_id)

    def chat(self, request: ChatRequest) -> dict[str, Any]:
        """Complete a chat request and record the usage it reported."""
        response = self._inner.chat(request)
        self._record(
            request.model, UsageSummary.from_raw(self._inner.parse_chat_response(response).usage)
        )
        return response

    def chat_stream(self, request: ChatRequest) -> Iterable[dict[str, Any]]:
        """Stream a chat request, recording the usage its chunks reported."""
        summary = UsageSummary()
        try:
            for chunk in self._inner.chat_stream(request):
                parsed = self._inner.parse_stream_chunk(chunk)
                if parsed is not None and parsed.usage:
                    summary = summary.merged_with(UsageSummary.from_raw(parsed.usage))
                yield chunk
        finally:
            self._record(request.model, summary)

    def parse_chat_response(self, response: dict[str, Any]) -> ParsedChatResponse:
        """Normalize a non-streaming chat response payload."""
        return self._inner.parse_chat_response(response)

    def parse_stream_chunk(self, chunk: dict[str, Any]) -> ParsedStreamChunk | None:
        """Normalize a streaming chunk payload."""
        return self._inner.parse_stream_chunk(chunk)

    def _record(self, model: str, summary: UsageSummary) -> None:
        """Append one ledger row for the model this call actually ran.

        Building the reporter is inside the swallow with the write: it reads
        the adapter's descriptor and catalog, and a provider that cannot
        answer must cost the caller its measurement, never its reply.
        """
        measured = usage_from_summary(summary)
        if measured is None:
            return
        try:
            reporter = self._reporters.get(model)
            if reporter is None:
                reporter = self._reporter_for(model)
                self._reporters[model] = reporter
        except Exception:
            logger.warning("Usage ledger reporter unavailable for %s", model, exc_info=True)
            return
        reporter.record(measured)


_PROVIDER_KIND = {
    UsageKind.CHAT: ProviderKind.CHAT,
    UsageKind.EMBEDDING: ProviderKind.EMBEDDING,
    UsageKind.RERANK: ProviderKind.RERANKING,
}


def usage_reporter(
    adapter: ProviderAdapter, kind: UsageKind, model: str, connection_id: UUID
) -> UsageReporter:
    """A reporter for one connection's calls, priced from the adapter's catalog."""
    provider_kind = _PROVIDER_KIND[kind]
    return UsageReporter(
        kind=kind,
        provider=adapter.descriptor.provider_type.value,
        model=model,
        connection_id=connection_id,
        pricing_lookup=lambda: catalog_pricing(adapter, provider_kind, model),
    )


def capture_chat(adapter: ProviderAdapter, connection_id: UUID) -> UsageCapturingChatProvider:
    """The connection's chat provider, ledgering every call it completes."""
    return UsageCapturingChatProvider(
        adapter.chat_provider(),
        lambda model: usage_reporter(adapter, UsageKind.CHAT, model, connection_id),
    )
