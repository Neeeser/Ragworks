/** Display labels and role mapping for prompt contexts. */

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

export const isNodeContext = (context: PromptContext): boolean =>
  NODE_CONTEXTS.includes(context);

interface TemplateFieldCopy {
  label: string;
  hint: string;
}

interface ContextRoleCopy {
  /** The paired system template, where the context carries one. */
  system?: TemplateFieldCopy;
  body: TemplateFieldCopy;
}

const NODE_ROLE_COPY: ContextRoleCopy = {
  system: {
    label: "System message",
    hint: "Instructions — sent as the system role.",
  },
  body: {
    label: "User message",
    hint: "Data payload — sent as the user role with the variables rendered in.",
  },
};

/**
 * What each context's templates become on the wire. Node prompts split
 * instructions (system role) from the data payload (user role); chat
 * prompts *are* the system prompt — the user's chat turns supply the user
 * messages.
 */
export const CONTEXT_ROLE_COPY: Record<PromptContext, ContextRoleCopy> = {
  "chat.base": {
    body: {
      label: "System prompt",
      hint: "Sent as the chat session's system message.",
    },
  },
  "chat.tool": {
    body: {
      label: "System prompt section",
      hint: "Merged into the chat system prompt as this collection's tool section.",
    },
  },
  "node.transform": NODE_ROLE_COPY,
  "node.rerank": NODE_ROLE_COPY,
  "node.generate": NODE_ROLE_COPY,
};
