"""Ledgering what Pinecone reported for one connection's data-plane reads.

Pinecone states its read-unit consumption on the response of every read it
bills (query, records-search, fetch), so the ledger stores the number the
provider stated, in the unit it stated it in. It publishes no price for a
read unit, so `cost_usd` stays null.

There is deliberately no write capture: upsert responses carry no `usage`
block, and the documented write-unit formula counts the size of the record
already stored, which the caller cannot see — a figure computed here would
be a guess recorded in a column whose contract is provider-stated fact.
"""

from __future__ import annotations

from uuid import UUID

from app.clients.pinecone import SPARSE_TEXT_EMBED_MODEL, PineconeUsage
from app.providers.usage_capture import UsageReporter
from app.schemas.enums import ProviderType, UsageKind, UsageUnit
from app.schemas.usage import MeasuredUsage, token_usage


class PineconeUsageLedger:
    """Writes one Pinecone connection's reported read usage to the ledger.

    Built where the connection is resolved (`app/vectorstores/registry.py`),
    because that is the only place the connection id is known. A store
    constructed without one measures nothing, which is what a caller holding
    a bare SDK client wants.
    """

    def __init__(self, connection_id: UUID) -> None:
        """Bind the ledger to the connection whose reads it records."""
        self._connection_id = connection_id
        self._reporters: dict[tuple[UsageKind, str], UsageReporter] = {}

    def record(self, index: str, usage: PineconeUsage) -> None:
        """Append a row per counter the response actually carried.

        `model` is the index name for read units: the index is the resource
        the units bill against. The embedding tokens a records-search reports
        were spent by the index's integrated sparse model, so they are
        recorded against that model under the embedding kind — the same spend
        an explicit embedding call would have made.
        """
        if usage.read_units is not None:
            self._reporter(UsageKind.VECTOR_STORE_READ, index).record(
                MeasuredUsage(quantity=usage.read_units, unit=UsageUnit.READ_UNITS)
            )
        if usage.embed_total_tokens is not None:
            self._reporter(UsageKind.EMBEDDING, SPARSE_TEXT_EMBED_MODEL).record(
                token_usage(prompt_tokens=usage.embed_total_tokens, completion_tokens=None)
            )

    def _reporter(self, kind: UsageKind, model: str) -> UsageReporter:
        """The reporter for one kind and resource, built at most once."""
        key = (kind, model)
        reporter = self._reporters.get(key)
        if reporter is None:
            reporter = UsageReporter(
                kind=kind,
                provider=ProviderType.PINECONE.value,
                model=model,
                connection_id=self._connection_id,
                # Pinecone publishes no per-unit price on any catalog we can
                # read, so every row here carries a quantity and a null cost.
                pricing_lookup=lambda: None,
            )
            self._reporters[key] = reporter
        return reporter


def record_read(ledger: PineconeUsageLedger | None, index: str, usage: object) -> None:
    """Ledger a read response's usage block, when there is a ledger to write to.

    Takes the raw SDK attribute so the store's call sites stay one line and
    an SDK response without a `usage` block records nothing rather than a
    zero.
    """
    if ledger is None:
        return
    parsed = PineconeUsage.from_sdk(usage)
    if parsed is not None:
        ledger.record(index, parsed)
