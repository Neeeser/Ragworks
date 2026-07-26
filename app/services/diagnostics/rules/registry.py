"""The ordered registry of diagnostic rules the service runs.

Adding a check is one rule class + one line here + tests -- the same
registry-driven pattern as nodes, vectorstores, and providers. Order controls
display order within a category grouping is done downstream, so keep the most
important checks first.
"""

from __future__ import annotations

from app.services.diagnostics.rules.base import DiagnosticRule
from app.services.diagnostics.rules.compatibility import BackendCapabilityRule
from app.services.diagnostics.rules.data import IndexProbeRule
from app.services.diagnostics.rules.embedding import (
    EmbeddingConnectionMismatchRule,
    EmbeddingDimensionMismatchRule,
    EmbeddingModelMismatchRule,
)
from app.services.diagnostics.rules.indexing import (
    BackendMismatchRule,
    Bm25IndexMismatchRule,
    DenseIndexMismatchRule,
    HybridTargetMismatchRule,
    IndexDimensionMismatchRule,
    NamespaceMismatchRule,
)
from app.services.diagnostics.rules.node_config import NodeConfigRule
from app.services.diagnostics.rules.runs import (
    RecentIngestionFailuresRule,
    RecentRetrievalFailuresRule,
)

DIAGNOSTIC_RULES: list[DiagnosticRule] = [
    EmbeddingModelMismatchRule(),
    EmbeddingConnectionMismatchRule(),
    EmbeddingDimensionMismatchRule(),
    BackendMismatchRule(),
    BackendCapabilityRule(),
    DenseIndexMismatchRule(),
    IndexDimensionMismatchRule(),
    NamespaceMismatchRule(),
    Bm25IndexMismatchRule(),
    HybridTargetMismatchRule(),
    IndexProbeRule(),
    NodeConfigRule(),
    RecentIngestionFailuresRule(),
    RecentRetrievalFailuresRule(),
]
