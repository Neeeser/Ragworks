import type { StatusTone } from "@/components/ui/status-dot";
import type { PipelineRunStatus } from "@/lib/types";

/** Compact duration for instrument labels: 12ms, 1.5s, 90s. */
export const formatDuration = (ms: number | null | undefined): string | null => {
  if (ms === null || ms === undefined) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
};

const STATUS_TONES: Record<PipelineRunStatus, StatusTone> = {
  running: "active",
  completed: "pos",
  degraded: "warn",
  failed: "neg",
  unsupported: "warn",
};

/**
 * Derived console tone for a run or node-run status. A status the frontend
 * does not know yet reads neutral rather than inventing a state.
 */
export const runStatusTone = (status: string): StatusTone =>
  STATUS_TONES[status as PipelineRunStatus] ?? "neutral";

/** `failed` → `Failed`: the backend value, humanised for display only. */
const humanise = (status: string): string =>
  status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

/**
 * The whole run's outcome. `degraded` spells itself out: at run level the
 * word alone reads as "the run degraded", when what happened is that every
 * node ran and one of them passed its input through.
 */
export const runStatusLabel = (status: string): string => {
  if (status === "degraded") return "Completed with degraded nodes";
  // Run-level only: every node ran, but no parse node read the file.
  if (status === "unsupported") return "Unsupported file";
  return humanise(status);
};

/** One node's own outcome, where `Degraded` says exactly what happened. */
export const nodeStatusLabel = (status: string): string => humanise(status);
