import type { SetupStepId } from "@/components/setup/lib/setup-wizard-reducer";
import type { SetupStatus } from "@/lib/types";

/**
 * Which step a returning user should land on, given derived readiness.
 *
 * Completion per step, all read from `GET /api/setup/status` rather than
 * guessed:
 *
 * - `providers` — the three required capabilities are covered
 *   (`has_embedding_provider`, `has_chat_provider`, `has_vector_store`).
 * - `model` — an embedding model has been chosen. Nothing records that: the
 *   choice lives in wizard state until `bootstrap` writes it into the
 *   scaffolded pipelines, so a page load never carries one.
 * - `index` — `has_index`, a registered index the user can actually select.
 * - `launch` — `has_collection` / `setup_complete`.
 *
 * Resume is the *earliest* incomplete step, never the furthest satisfied one,
 * so a user is never carried past a decision they still have to make. Because
 * the model step is never pre-satisfied, that walk always stops at or before
 * `model` — `index` and `launch` are unreachable resume targets by
 * construction, not by omission.
 */
export function resumeStep(status: SetupStatus | null): SetupStepId {
  // Unknown readiness (still loading, or the fetch failed) resumes nothing:
  // skipping a step on a guess is worse than one extra click.
  if (!status) return "welcome";
  // A finished workspace stays on welcome so the wizard's redirect to
  // /dashboard — which only fires from welcome — still owns the navigation.
  if (status.setup_complete) return "welcome";
  if (!hasStarted(status)) return "welcome";
  if (!providersComplete(status)) return "providers";
  return "model";
}

/** Whether the required embedding/chat/vector-store capabilities are covered. */
function providersComplete(status: SetupStatus): boolean {
  return status.has_embedding_provider && status.has_chat_provider && status.has_vector_store;
}

/**
 * Whether this workspace has any setup progress worth resuming into.
 *
 * `has_vector_store` is deliberately excluded: pgvector ships built in, so it
 * is true on a brand-new deployment and counting it would mean no workspace
 * ever looks fresh — every first-run user would skip the welcome step.
 */
function hasStarted(status: SetupStatus): boolean {
  return (
    status.has_embedding_provider ||
    status.has_chat_provider ||
    status.has_index ||
    status.has_collection
  );
}
