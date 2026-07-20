"use client";

import { formatPercent } from "@/components/evals/lib/metrics";
import { GlassCard } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

import type { EvalFinding, FunnelSummary } from "@/lib/types";

interface FunnelPanelProps {
  funnel: FunnelSummary;
}

const SEVERITY_TONE: Record<EvalFinding["severity"], string> = {
  critical: "bg-data-neg",
  warning: "bg-data-warn",
  info: "bg-stage-neutral",
};

/**
 * Gold-document retention per pipeline node, in trace order, with the
 * deterministic findings derived from it. Stage 0 is ingestion coverage.
 */
export function FunnelPanel({ funnel }: FunnelPanelProps) {
  if (funnel.stages.length === 0) {
    return null;
  }
  return (
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
        Gold retention by node
      </p>
      <ul className="mt-4 space-y-3">
        {funnel.stages.map((stage) => (
          <li key={stage.node_id}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="min-w-0 truncate text-sm text-body">
                {stage.label}
                <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.2em] text-meta">
                  {stage.node_id === "ingestion" ? "ingestion" : stage.node_type}
                </span>
              </p>
              <p className="shrink-0 font-mono text-xs text-primary">
                {formatPercent(stage.retention)}
                <span className="ml-2 text-meta">
                  {stage.gold_retained}/{stage.gold_total}
                </span>
              </p>
            </div>
            <div
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-strong"
              role="img"
              aria-label={`${stage.label}: ${formatPercent(stage.retention)} of gold documents retained`}
            >
              <div
                className="h-full rounded-full bg-accent-cyan"
                style={{ width: `${Math.max(0, Math.min(1, stage.retention)) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {funnel.findings.length > 0 && (
        <div className="mt-6 border-t border-hairline pt-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Findings</p>
          <ul className="mt-3 space-y-3">
            {funnel.findings.map((finding, index) => (
              <li key={`${finding.node_id}-${index}`} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    SEVERITY_TONE[finding.severity],
                  )}
                />
                <p className="text-sm leading-relaxed text-body">{finding.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GlassCard>
  );
}
