/**
 * Where a ledger row's context lives in the app.
 *
 * A context type with no page returns `null` and renders as plain text — a
 * link to a route that does not exist is worse than naming the thing.
 */

const CONTEXT_HREFS: Record<string, (id: string) => string> = {
  chat_session: (id) => `/chat/${id}`,
  eval_run: (id) => `/evals/runs/${id}`,
  eval_dataset: (id) => `/evals/datasets/${id}`,
  pipeline_run: (id) => `/traces/runs/${id}`,
};

const CONTEXT_LABELS: Record<string, string> = {
  chat_session: "Chat session",
  eval_run: "Eval run",
  eval_dataset: "Eval dataset",
  pipeline_run: "Pipeline run",
};

export function usageContextHref(
  contextType: string | null,
  contextId: string | null,
): string | null {
  if (!contextType || !contextId) return null;
  return CONTEXT_HREFS[contextType]?.(contextId) ?? null;
}

/** "Eval run" for a known context, else the raw type — never a blank cell. */
export function usageContextLabel(contextType: string | null): string | null {
  if (!contextType) return null;
  return CONTEXT_LABELS[contextType] ?? contextType.replaceAll("_", " ");
}
