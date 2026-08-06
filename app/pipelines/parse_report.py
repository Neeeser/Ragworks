"""What a run's parse nodes took responsibility for.

Which formats a parse node reads is registry data, so whether a file was
read at all is a fact about the run rather than about any one node: in a
fan-out every branch sees the file and only the branch that answers for
its content type produces anything. The report collects those per-item
outcomes so ingestion can tell "nothing parsed this file" apart from
"parsed, and it held nothing" — the first is a failure, the second is an
empty document.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ParseReport:
    """Per-file outcomes of the parse nodes a run executed."""

    #: Ids of file items some parse node read.
    handled: set[str] = field(default_factory=set)
    #: Content type of each file item, for every item no node has read yet.
    unhandled: dict[str, str] = field(default_factory=dict)

    def record_handled(self, item_id: str) -> None:
        """Note that a parse node read this file item."""
        self.handled.add(item_id)
        self.unhandled.pop(item_id, None)

    def record_unhandled(self, item_id: str, media_type: str) -> None:
        """Note that a parse node had no handler for this file item."""
        if item_id not in self.handled:
            self.unhandled[item_id] = media_type

    def unclaimed_media_types(self) -> list[str]:
        """Content types every parse node that saw them declined to read."""
        return sorted(set(self.unhandled.values()))
