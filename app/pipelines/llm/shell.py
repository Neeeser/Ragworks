"""The base every `llm.*` node shell extends.

It owns the per-run call record — the mechanism the engine picked, the
retries it spent, and the failures it absorbed — because all four shells
record the same three things and read them back into the same trace
summary. The absorbed failures are also what makes the node run degraded,
so a shell that kept its own copy could report a clean run for a call that
never succeeded.
"""

from __future__ import annotations

from typing import TypeVar

from app.pipelines.execution.context import PipelineRunContext
from app.pipelines.llm.config import LlmNodeConfig
from app.pipelines.llm.engine import LlmEngine
from app.pipelines.node import PipelineNodeBase

LlmConfigT = TypeVar("LlmConfigT", bound=LlmNodeConfig)


class LlmShellNode(PipelineNodeBase[LlmConfigT]):
    """A facet shell over `LlmEngine` with its per-run call record."""

    def __init__(self, config: LlmConfigT) -> None:
        """Initialize the node and its per-run trace stash."""
        super().__init__(config)
        self._warnings: list[str] = []
        self._retries = 0
        self._mechanism: str | None = None

    def _engine(self, context: PipelineRunContext) -> LlmEngine:
        """Build this run's engine and stash the mechanism it chose.

        Strictness comes from the run kind — an ingestion run has a
        `document` — and the engine tightens it further when the node's own
        `on_failure` says to fail.
        """
        engine = LlmEngine(
            context.providers,
            self.config,
            node_label=self.label,
            strict=context.document is not None,
        )
        self._mechanism = engine.mechanism
        return engine

    def _record_calls(self, engine: LlmEngine, retries: int) -> None:
        """Stash what this run's calls cost and what they had to absorb."""
        self._warnings = engine.warnings
        self._retries = retries

    def degraded_reasons(self) -> tuple[str, ...]:
        """The provider failures this run passed through instead of raising."""
        return tuple(self._warnings)
