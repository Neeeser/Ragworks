"""Evals subsystem: benchmark retrieval evaluation with trace attribution.

`EvalService` is the public API; consumers import other names from the owning
submodule (e.g. `app.evals.metrics.registry`, `app.evals.execution.runner`).
"""

from __future__ import annotations

from app.evals.service import EvalService

__all__ = ["EvalService"]
