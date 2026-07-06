"""Pipeline tracing: recording (`recorder.py`) and typed summaries (`summaries.py`).

Re-exports `recorder.py`'s public surface -- `NodeTraceValue`, `NodeTraceSummary`,
`PipelineTraceRecorder`, `serialize_payload` -- at the package root so existing
`from app.pipelines.tracing import X` call sites keep working now that this is
a package instead of a single module. Summary models and summarizer functions
(`SourceSummary`, `summarize_text`, `TokenUsage`, ...) live in `summaries.py`
and are imported from there directly (`app.pipelines.tracing.summaries`) --
they weren't part of the old `tracing.py` module's surface, so they aren't
re-exported here.
"""

from __future__ import annotations

from app.pipelines.tracing.recorder import (
    NodeTraceSummary,
    NodeTraceValue,
    PipelineTraceRecorder,
    serialize_payload,
)

__all__ = [
    "NodeTraceSummary",
    "NodeTraceValue",
    "PipelineTraceRecorder",
    "serialize_payload",
]
