"""Shared LLM-call engine behind the `llm.*` pipeline nodes.

One abstraction owns the whole call lifecycle — render prompts, force a
structured output, parse and validate the response, map fields back onto
items, account tokens — and the node types (`llm.transform`, `llm.rerank`,
`llm.generate`) are thin facet shells over it. Named methods (contextual
retrieval, HyDE, query expansion) are presets: seeded configs, not code.
"""

from app.pipelines.llm.engine import LlmEngine

__all__ = ["LlmEngine"]
