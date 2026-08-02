/** Display labels for prompt contexts, keyed by the wire enum. */

import type { PromptContext } from "@/lib/types";

export const CONTEXT_LABELS: Record<PromptContext, string> = {
  "chat.base": "Chat base",
  "chat.tool": "Collection tool",
  "node.transform": "Transform node",
  "node.rerank": "Rerank node",
  "node.generate": "Generate node",
};

/** Contexts whose prompts pair a system template with the main one. */
export const SYSTEM_BODY_CONTEXTS: readonly PromptContext[] = [
  "node.transform",
  "node.rerank",
  "node.generate",
];

/** Contexts whose test bench runs the structured-output engine path. */
export const NODE_CONTEXTS = SYSTEM_BODY_CONTEXTS;
