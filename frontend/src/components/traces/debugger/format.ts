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
  failed: "neg",
};

/**
 * Derived console tone for a run or node-run status. A status the frontend
 * does not know yet reads neutral rather than inventing a state.
 */
export const runStatusTone = (status: string): StatusTone =>
  STATUS_TONES[status as PipelineRunStatus] ?? "neutral";

/** `failed` → `Failed`: the backend value, humanised for display only. */
export const runStatusLabel = (status: string): string =>
  status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
