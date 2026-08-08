"use client";

import Link from "next/link";

import { runLabel } from "@/components/evals/lib/comparison";
import { runOutcome } from "@/components/evals/lib/status";
import { CustomSelect } from "@/components/ui/custom-select";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Panel, PanelGrid } from "@/components/ui/panel";
import { Readout } from "@/components/ui/readout";
import { StatusDot } from "@/components/ui/status-dot";

import type { EvalComparisonSide, EvalRunSummary } from "@/lib/types";

interface ComparisonSidesProps {
  runs: EvalRunSummary[];
  runAId: string | null;
  runBId: string | null;
  sideA: EvalComparisonSide | null;
  sideB: EvalComparisonSide | null;
  onSelect: (side: "a" | "b", runId: string) => void;
}

/** The two runs under comparison: which run each side is, and how it ran. */
export function ComparisonSides({
  runs,
  runAId,
  runBId,
  sideA,
  sideB,
  onSelect,
}: ComparisonSidesProps) {
  return (
    <PanelGrid columns={2} className="items-start">
      <SidePanel
        letter="A"
        runs={runs}
        selectedId={runAId}
        otherId={runBId}
        side={sideA}
        onSelect={(runId) => onSelect("a", runId)}
      />
      <SidePanel
        letter="B"
        runs={runs}
        selectedId={runBId}
        otherId={runAId}
        side={sideB}
        onSelect={(runId) => onSelect("b", runId)}
      />
    </PanelGrid>
  );
}

function SidePanel({
  letter,
  runs,
  selectedId,
  otherId,
  side,
  onSelect,
}: {
  letter: "A" | "B";
  runs: EvalRunSummary[];
  selectedId: string | null;
  otherId: string | null;
  side: EvalComparisonSide | null;
  onSelect: (runId: string) => void;
}) {
  const status = side ? runOutcome(side.status, side.degraded_count) : null;
  return (
    <Panel className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <InstrumentLabel className="w-10 shrink-0">Run {letter}</InstrumentLabel>
        <CustomSelect
          aria-label={`Run ${letter}`}
          value={selectedId ?? ""}
          placeholder="Pick a run"
          className="min-w-0 flex-1"
          options={runs.map((run) => ({
            value: run.id,
            label: runLabel(run),
            // The same run on both sides is not a comparison; it stays
            // listed so the user can see why it cannot be picked.
            disabled: run.id === otherId,
          }))}
          onValueChange={onSelect}
        />
      </div>
      {side && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            {status && <StatusDot tone={status.tone} label={status.label} />}
            {side.dataset_name && <Readout label="Dataset">{side.dataset_name}</Readout>}
            {side.retrieval_pipeline_name && (
              <Readout label="Search tool">{side.retrieval_pipeline_name}</Readout>
            )}
            {side.ingestion_pipeline_name && (
              <Readout label="Ingestion">{side.ingestion_pipeline_name}</Readout>
            )}
            <Readout label="Scored">{side.scored_count.toLocaleString()}</Readout>
            {side.failed_count > 0 && (
              <Readout label="Failed">{side.failed_count.toLocaleString()}</Readout>
            )}
            {side.unscored_count > 0 && (
              <Readout label="Unscored">{side.unscored_count.toLocaleString()}</Readout>
            )}
            {side.degraded_count > 0 && (
              <Readout label="Degraded">{side.degraded_count.toLocaleString()}</Readout>
            )}
          </div>
          <Link
            href={`/evals/runs/${side.id}`}
            className="w-fit rounded-control text-ui text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            Open run {letter}
          </Link>
        </>
      )}
    </Panel>
  );
}
