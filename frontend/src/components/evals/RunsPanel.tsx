"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatMetric, headlineAggregate, isRunActive } from "@/components/evals/lib/metrics";
import { RunStatusBadge } from "@/components/evals/RunStatusBadge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GlassCard } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/datetime";

import type { EvalDataset, EvalMetricInfo, EvalRunCoverage, EvalRunSummary } from "@/lib/types";

interface RunsPanelProps {
  runs: EvalRunSummary[];
  datasets: EvalDataset[];
  metricCatalog: EvalMetricInfo[];
  loading: boolean;
  onNewRun: () => void;
  onDeleteRun: (runId: string) => Promise<boolean>;
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
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Runs</p>
        <Button onClick={onNewRun} className="px-5">
          New run
        </Button>
      </div>
      {runs.length === 0 ? (
        <p className="mt-6 text-sm text-muted">
          {loading ? "Loading runs…" : "No eval runs yet. Import a dataset and start one."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
                <th className="py-2 pr-4 font-normal">Run</th>
                <th className="py-2 pr-4 font-normal">Dataset</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 pr-4 font-normal">Progress</th>
                <th className="py-2 pr-4 font-normal">Coverage</th>
                <th className="py-2 pr-4 font-normal">Score</th>
                <th className="py-2 pr-4 font-normal">Started</th>
                <th className="py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-hairline last:border-b-0">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/evals/runs/${run.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent-violet"
                    >
                      {run.name || `Run ${run.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-body">{datasetNames.get(run.dataset_id) ?? "—"}</td>
                  <td className="py-3 pr-4">
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-body">
                    {run.progress_total > 0 ? `${run.progress_done}/${run.progress_total}` : "—"}
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-body">
                    <CoverageCell coverage={run.coverage ?? null} />
                  </td>
                  <td className="py-3 pr-4 font-mono text-xs text-body">
                    <HeadlineCell aggregates={run.aggregate_metrics} catalog={metricCatalog} />
                  </td>
                  <td className="py-3 pr-4 text-xs text-muted">{formatDateTime(run.created_at)}</td>
                  <td className="py-3 text-right">
                    {!isRunActive(run.status) && (
                      <button
                        type="button"
                        aria-label={`Delete run ${run.name || run.id.slice(0, 8)}`}
                        className="rounded-full p-2 text-muted transition hover:bg-surface-strong hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
                        onClick={() => setPendingDelete(run)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </GlassCard>
  );
}

/** Share of the dataset the run covered: corpus ingested and queries evaluated. */
function CoverageCell({ coverage }: { coverage: EvalRunCoverage | null }) {
  if (!coverage) return <>—</>;
  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip
        content={`${coverage.corpus_ingested.toLocaleString()} of ${coverage.corpus_total.toLocaleString()} corpus documents ingested`}
      >
        <span className="cursor-default">
          docs {percent(coverage.corpus_ingested, coverage.corpus_total)}
        </span>
      </Tooltip>
      <span aria-hidden className="text-meta">
        ·
      </span>
      <Tooltip
        content={`${coverage.queries_done.toLocaleString()} of ${coverage.queries_total.toLocaleString()} dataset queries evaluated`}
      >
        <span className="cursor-default">
          queries {percent(coverage.queries_done, coverage.queries_total)}
        </span>
      </Tooltip>
    </span>
  );
}

function percent(done: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((done / total) * 100)}%`;
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
  if (!headline) return <>—</>;
  return (
    <>
      {formatMetric(headline.value)}
      <span className="ml-1.5 text-meta">
        {headline.name}@{headline.k}
      </span>
    </>
  );
}
