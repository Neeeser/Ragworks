"use client";

import { deltaTextClass, formatPercentDelta } from "@/components/evals/lib/comparison";
import { formatPercent } from "@/components/evals/lib/metrics";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelHeader } from "@/components/ui/panel";

import type { EvalFunnelStageDelta } from "@/lib/types";

/**
 * Gold retention per node on both runs, bars aligned on one node row.
 *
 * Two series, so both are directly labelled (A / B) rather than resting on
 * colour. A node only one run has keeps its row with an em-dash: two runs on
 * different pipelines share only the ingestion stage, and hiding the rest
 * would claim the pipelines matched.
 */
export function ComparisonFunnel({ stages }: { stages: EvalFunnelStageDelta[] }) {
  if (stages.length === 0) return null;

  return (
    <Panel>
      <PanelHeader title="Gold retention by node" />
      <ul className="space-y-3 p-3">
        {stages.map((stage) => (
          <li key={stage.node_id}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-ui text-body">{stage.label}</span>
                <span className="shrink-0 font-mono text-instrument text-meta">
                  {stage.node_id === "ingestion" ? "ingestion" : stage.node_type}
                </span>
              </p>
              <p
                className={`shrink-0 font-mono text-ui tabular-nums ${deltaTextClass(stage.delta)}`}
              >
                {formatPercentDelta(stage.delta)}
              </p>
            </div>
            <StageBar label="A" retention={stage.retention_a} stage={stage.label} series={1} />
            <StageBar label="B" retention={stage.retention_b} stage={stage.label} series={2} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function StageBar({
  label,
  retention,
  stage,
  series,
}: {
  label: "A" | "B";
  retention: number | null | undefined;
  stage: string;
  series: 1 | 2;
}) {
  const missing = retention === null || retention === undefined;
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <InstrumentLabel className="w-4 shrink-0">{label}</InstrumentLabel>
      {missing ? (
        <span className="flex-1 text-ui text-muted">Not in this run</span>
      ) : (
        <Meter
          value={retention}
          label={`${stage} retention, run ${label}`}
          valueText={`${formatPercent(retention)} of gold documents retained`}
          fillClassName={series === 1 ? "bg-series-1" : "bg-series-2"}
          className="flex-1"
        />
      )}
      <span className="w-10 shrink-0 text-right font-mono text-instrument tabular-nums text-primary">
        {missing ? "—" : formatPercent(retention)}
      </span>
    </div>
  );
}
