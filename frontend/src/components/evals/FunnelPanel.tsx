"use client";

import { formatPercent } from "@/components/evals/lib/metrics";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { StatusDot } from "@/components/ui/status-dot";

import type { StatusTone } from "@/components/ui/status-dot";
import type { EvalFinding, FunnelSummary } from "@/lib/types";

interface FunnelPanelProps {
  funnel: FunnelSummary;
}

/** Severity is state, so it wears the status tones — never a series colour. */
const SEVERITY: Record<EvalFinding["severity"], { tone: StatusTone; label: string }> = {
  critical: { tone: "neg", label: "Critical" },
  warning: { tone: "warn", label: "Warning" },
  info: { tone: "neutral", label: "Info" },
};

/**
 * Gold-document retention per pipeline node, in trace order, with the
 * deterministic findings derived from it. Stage 0 is ingestion coverage.
 *
 * A measure per category, so horizontal bars — and they read `--series-1`
 * rather than an accent, because a bar is a chart mark and the accents are
 * chrome.
 */
export function FunnelPanel({ funnel }: FunnelPanelProps) {
  if (funnel.stages.length === 0) {
    return null;
  }
  return (
    <Panel>
      <PanelHeader title="Gold retention by node" />

      <ul className="space-y-3 p-3">
        {funnel.stages.map((stage) => (
          <li key={stage.node_id}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-ui text-body">{stage.label}</span>
                {/* The node's type id is a literal the pipeline stores, so it
                    renders verbatim in mono rather than in a label voice. */}
                <span className="shrink-0 font-mono text-instrument text-meta">
                  {stage.node_id === "ingestion" ? "ingestion" : stage.node_type}
                </span>
              </p>
              <p className="shrink-0 font-mono text-ui tabular-nums text-primary">
                {formatPercent(stage.retention)}
                <span className="ml-2 text-instrument text-meta">
                  {stage.gold_retained}/{stage.gold_total}
                </span>
              </p>
            </div>
            <Meter
              value={stage.retention}
              label={`${stage.label} retention`}
              valueText={`${formatPercent(stage.retention)} of gold documents retained`}
              className="mt-1.5"
            />
          </li>
        ))}
      </ul>

      {funnel.findings.length > 0 && (
        <div className="border-t border-hairline p-3">
          <InstrumentLabel className="block">Findings</InstrumentLabel>
          <ul className="mt-2 space-y-2">
            {funnel.findings.map((finding, index) => (
              <li key={`${finding.node_id}-${index}`} className="flex items-start gap-3">
                {/* Named, not colour alone — the severity word travels with the
                    dot so the finding still ranks without hue discrimination. */}
                <StatusDot
                  tone={SEVERITY[finding.severity].tone}
                  label={SEVERITY[finding.severity].label}
                  className="mt-1 w-16 shrink-0"
                />
                <p className="max-w-[66ch] text-ui text-body">{finding.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
