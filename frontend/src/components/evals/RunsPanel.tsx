"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { formatMetric, headlineAggregate, isRunActive } from "@/components/evals/lib/metrics";
import { runOutcome } from "@/components/evals/lib/status";
import { formatUsage, runCost, runTokens } from "@/components/evals/lib/usage";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataRow, DataRowHeader, DataRowSkeleton } from "@/components/ui/data-row";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { PulseWire } from "@/components/ui/pulse-wire";
import { StatusDot } from "@/components/ui/status-dot";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type {
  EvalDataset,
  EvalMetricInfo,
  EvalRunCoverage,
  EvalRunSummary,
  EvalRunUsage,
} from "@/lib/types";

interface RunsPanelProps {
  runs: EvalRunSummary[];
  datasets: EvalDataset[];
  metricCatalog: EvalMetricInfo[];
  loading: boolean;
  onNewRun: () => void;
  onDeleteRun: (runId: string) => Promise<boolean>;
}

/**
 * Column widths shared by the header, every row, and the loading placeholder.
 *
 * The three narrowest-value columns fold away below `xl`: a row list drops
 * columns before it drops rows, and the run's own page carries the full record.
 */
const COL = {
  dataset: "hidden w-40 xl:block",
  status: "w-28",
  progress: "hidden w-16 text-right lg:block",
  // Sized to the widest real rendering ("docs 100% queries 100%") — one step
  // narrower and the cell's flex items shrink, their text wraps at the inner
  // space, and that one row turns two lines tall.
  coverage: "hidden w-40 text-right lg:block",
  // Wide enough for "12,340 tk · $0.0031"; folds with the other detail columns.
  spend: "hidden w-32 text-right lg:block",
  score: "w-28 text-right",
  started: "w-14 text-right",
};

function ColumnHeader() {
  return (
    <DataRowHeader
      title="Run"
      columns={[
        <InstrumentLabel key="dataset" className={COL.dataset}>
          Dataset
        </InstrumentLabel>,
        <InstrumentLabel key="status" className={COL.status}>
          Status
        </InstrumentLabel>,
        <InstrumentLabel key="progress" className={COL.progress}>
          Done
        </InstrumentLabel>,
        <InstrumentLabel key="coverage" className={COL.coverage}>
          Coverage
        </InstrumentLabel>,
        <InstrumentLabel key="spend" className={COL.spend}>
          Spend
        </InstrumentLabel>,
        <InstrumentLabel key="score" className={COL.score}>
          Score
        </InstrumentLabel>,
        <InstrumentLabel key="started" className={COL.started}>
          Started
        </InstrumentLabel>,
      ]}
    />
  );
}

export function RunsPanel({
  runs,
  datasets,
  metricCatalog,
  loading,
  onNewRun,
  onDeleteRun,
}: RunsPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<EvalRunSummary | null>(null);
  const datasetNames = new Map(datasets.map((dataset) => [dataset.id, dataset.name]));

  return (
    // A landmark per region: this page carries three peer lists, and a named
    // section each is how a screen reader user moves between them.
    <section aria-label="Runs" className="card-surface">
      <ColumnHeader />
      {loading ? (
        <DataRowSkeleton
          label="Loading runs"
          columnWidths={[
            COL.dataset,
            COL.status,
            COL.progress,
            COL.coverage,
            COL.spend,
            COL.score,
            COL.started,
          ]}
        />
      ) : runs.length === 0 ? (
        <div className="p-8 text-center">
          <p className="mx-auto max-w-[66ch] text-ui text-muted">
            No eval runs yet. A run replays a dataset&apos;s queries through an ingestion pipeline
            and a search tool, and scores what came back against its relevance judgments.
          </p>
          <Button size="sm" className="mt-3" onClick={onNewRun}>
            New run
          </Button>
        </div>
      ) : (
        runs.map((run) => {
          const state = runOutcome(run.status, run.degraded_count);
          const name = run.name || `Run ${run.id.slice(0, 8)}`;
          return (
            <DataRow
              key={run.id}
              href={`/evals/runs/${run.id}`}
              title={name}
              /* The pulse is the row's only motion, and it runs only while the
                 run is actually producing results — it unmounts the moment the
                 status settles. */
              subtitle={state.live ? <PulseWire label={`${name} in progress`} /> : undefined}
              columns={[
                <span key="dataset" className={`truncate text-ui text-muted ${COL.dataset}`}>
                  {datasetNames.get(run.dataset_id) ?? "—"}
                </span>,
                <StatusDot
                  key="status"
                  tone={state.tone}
                  label={state.label}
                  className={COL.status}
                />,
                <span
                  key="progress"
                  className={`font-mono tabular-nums text-instrument ${COL.progress}`}
                >
                  {run.progress_total > 0 ? `${run.progress_done}/${run.progress_total}` : "—"}
                </span>,
                <span key="coverage" className={COL.coverage}>
                  <CoverageCell coverage={run.coverage ?? null} />
                </span>,
                <span
                  key="spend"
                  className={`truncate font-mono tabular-nums text-instrument ${COL.spend}`}
                >
                  <SpendCell usage={run.usage ?? null} />
                </span>,
                <span key="score" className={`font-mono tabular-nums ${COL.score}`}>
                  <HeadlineCell aggregates={run.aggregate_metrics} catalog={metricCatalog} />
                </span>,
                <Tooltip
                  key="started"
                  content={parseApiDate(run.created_at)?.toLocaleString() ?? ""}
                  triggerClassName={`justify-end ${COL.started}`}
                >
                  <span className="font-mono tabular-nums text-instrument text-meta">
                    {formatTimeAgoCompact(run.created_at)}
                  </span>
                </Tooltip>,
              ]}
              actions={
                /* An in-flight run is cancelled from its own page, not deleted
                   from under itself, so the action is absent rather than
                   disabled. */
                isRunActive(run.status) ? null : (
                  <Tooltip content="Delete run" side="left">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete run ${name}`}
                      className="hover:text-data-neg"
                      onClick={() => setPendingDelete(run)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </Tooltip>
                )
              }
            />
          );
        })
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete eval run"
        description={`Delete ${pendingDelete?.name || "this run"} and its per-query results. The benchmark collection is kept.`}
        confirmLabel="Delete run"
        confirmVariant="danger"
        onConfirm={async () => {
          if (pendingDelete) await onDeleteRun(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}

/** Share of the dataset the run covered: corpus ingested and queries evaluated. */
function CoverageCell({ coverage }: { coverage: EvalRunCoverage | null }) {
  if (!coverage) return <span className="font-mono tabular-nums text-instrument">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap font-mono tabular-nums text-instrument">
      <Tooltip
        content={`${coverage.corpus_ingested.toLocaleString()} of ${coverage.corpus_total.toLocaleString()} corpus documents ingested`}
      >
        <span>docs {percent(coverage.corpus_ingested, coverage.corpus_total)}</span>
      </Tooltip>
      <Tooltip
        content={`${coverage.queries_done.toLocaleString()} of ${coverage.queries_total.toLocaleString()} dataset queries evaluated`}
      >
        <span>queries {percent(coverage.queries_done, coverage.queries_total)}</span>
      </Tooltip>
    </span>
  );
}

function percent(done: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((done / total) * 100)}%`;
}

/** Tokens (and dollars when priced) this run's own work cost. */
function SpendCell({ usage }: { usage: EvalRunUsage | null }) {
  const summary = formatUsage(runTokens(usage), runCost(usage));
  if (!summary) return <span className="text-muted">—</span>;
  return <Tooltip content={summary}>{summary.replace(" tokens", " tk")}</Tooltip>;
}

/** The run's first catalog-ordered computed metric at its deepest cutoff. */
function HeadlineCell({
  aggregates,
  catalog,
}: {
  aggregates: Record<string, number>;
  catalog: EvalMetricInfo[];
}) {
  const headline = headlineAggregate(aggregates, catalog);
  if (!headline) return <span className="text-muted">—</span>;
  return (
    <>
      {formatMetric(headline.value)}
      {/* The metric's identity, not a number — it names which score this is. */}
      <span className="ml-1.5 text-instrument text-meta">
        {headline.name}@{headline.k}
      </span>
    </>
  );
}
