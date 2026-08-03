/**
 * Which structured-output write targets each node context allows — the
 * frontend mirror of `CONTEXT_TARGETS` in `app/pipelines/llm/validation.py`
 * (backend validation is the hard gate; this keeps the builder from
 * offering targets that would immediately error).
 */

import type { LlmOutputTarget, PromptContext } from "@/lib/types";

const TARGETS: Partial<Record<PromptContext, LlmOutputTarget["kind"][]>> = {
  "node.transform": ["metadata", "text"],
  "node.rerank": ["score", "metadata"],
  "node.generate": ["items"],
};

export const contextTargets = (context: PromptContext): LlmOutputTarget["kind"][] =>
  TARGETS[context] ?? [];
