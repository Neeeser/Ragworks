import type { EvalRunUsage, EvalUsage } from "@/lib/types";

/**
 * Reading an eval job's reported spend.
 *
 * Tokens are always reported; dollars only where the provider published
 * per-token pricing, so a missing cost renders as nothing rather than $0.00.
 */

/** The token count to report: the total, or the prompt side when that is all
 * the provider counted. `null` means nothing was reported at all. */
export function usageTokens(usage: EvalUsage | null | undefined): number | null {
  if (!usage) return null;
  if (usage.total_tokens != null) return usage.total_tokens;
  return usage.prompt_tokens ?? null;
}

/** A run's tokens across both phases, or `null` when neither reported any. */
export function runTokens(usage: EvalRunUsage | null | undefined): number | null {
  if (!usage) return null;
  return addOptional(usageTokens(usage.ingestion), usageTokens(usage.retrieval));
}

/**
 * A run's dollars across both phases, or `null` when nothing was priced —
 * including when only one phase was: a figure covering a subset of the
 * reported tokens reads as the whole run's cost.
 */
export function runCost(usage: EvalRunUsage | null | undefined): number | null {
  if (!usage) return null;
  const phases = [usage.ingestion, usage.retrieval];
  if (phases.some((phase) => usageTokens(phase) != null && phase.cost_usd == null)) return null;
  return addOptional(usage.ingestion.cost_usd ?? null, usage.retrieval.cost_usd ?? null);
}

/** Group-separated token count. */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}

/**
 * A dollar amount at the precision the number actually needs: embedding spend
 * is routinely fractions of a cent, and rounding it to two places prints $0.00
 * for a real cost. Written out in full rather than via `toPrecision`, which
 * switches to exponent notation below 1e-7 — "$3.0e-8" is not a price.
 */
export function formatUsd(cost: number): string {
  if (cost === 0) return "$0";
  if (cost >= 0.01) return `$${cost.toFixed(2)}`;
  const decimals = Math.min(12, 1 - Math.floor(Math.log10(cost)));
  return `$${cost.toFixed(decimals).replace(/0+$/, "")}`;
}

/** "12,340 tokens · $0.0031", dropping the cost when nothing published a price. */
export function formatUsage(tokens: number | null, cost: number | null): string | null {
  if (tokens == null) return null;
  const counted = `${formatTokens(tokens)} tokens`;
  return cost == null ? counted : `${counted} · ${formatUsd(cost)}`;
}

/** Elapsed wall-clock between two timestamps, or `null` while one is missing. */
export function formatDuration(
  startedAt: string,
  completedAt: string | null | undefined,
): string | null {
  if (!completedAt) return null;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function addOptional(left: number | null, right: number | null): number | null {
  if (left == null) return right;
  if (right == null) return left;
  return left + right;
}
