"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { FunnelPanel } from "@/components/evals/FunnelPanel";
import { useRunDetail } from "@/components/evals/hooks/use-run-detail";
import { ItemsTable } from "@/components/evals/ItemsTable";
import { MetricCards } from "@/components/evals/MetricCards";
import { RunStatusBadge } from "@/components/evals/RunStatusBadge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/panel";

import type { EvalRun } from "@/lib/types";

export function RunDetail({ runId }: { runId: string }) {
  const { run, items, metricCatalog, dataset, pipelines, active, cancel, actionError } =
    useRunDetail(runId);

  if (run.error) {
    return <p className="text-sm text-data-neg">{run.error}</p>;
  }
  if (!run.data) {
    return <p className="text-sm text-muted">Loading run…</p>;
  }
  const detail = run.data;
  const pipelineName = (id: string) =>
    (pipelines.data ?? []).find((pipeline) => pipeline.id === id)?.name ?? null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/evals"
            className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.28em] text-muted transition hover:text-primary focus-visible:ring-2 focus-visible:ring-accent-violet"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Evals
          </Link>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-primary">
            {detail.name || `Run ${detail.id.slice(0, 8)}`}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <RunStatusBadge status={detail.status} />
            <RunFacts
              detail={detail}
              datasetName={dataset.data?.name ?? null}
              ingestionName={pipelineName(detail.ingestion_pipeline_id)}
              retrievalName={pipelineName(detail.retrieval_pipeline_id)}
            />
          </div>
        </div>
        {active && (
          <Button variant="secondary" onClick={cancel} className="px-5">
            Cancel run
          </Button>
        )}
      </div>

      {actionError && <p className="text-sm text-data-neg">{actionError}</p>}
      {detail.error_message && <p className="text-sm text-data-neg">{detail.error_message}</p>}
      {detail.failed_count > 0 && (
        <p className="text-sm text-data-neg">
          {detail.failed_count} of {detail.config.num_queries} queries failed to evaluate;
          aggregates are means over the remaining queries only.
        </p>
      )}

      {active && <ProgressCard detail={detail} />}

      <MetricCards aggregates={detail.aggregate_metrics} catalog={metricCatalog.data ?? []} />
      <FunnelPanel funnel={detail.funnel} />
      <ItemsTable
        items={items.data?.items ?? []}
        documentTitles={items.data?.document_titles ?? {}}
        stages={detail.funnel.stages}
        kValues={detail.config.k_values}
      />
    </div>
  );
}

/** Live progress while the run provisions, ingests, or evaluates. */
function ProgressCard({ detail }: { detail: EvalRun }) {
  const percent =
    detail.progress_total > 0
      ? Math.round((detail.progress_done / detail.progress_total) * 100)
      : 0;
  return (
    <GlassCard className="rounded-3xl border border-hairline bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
          {detail.status === "running" ? "Evaluating queries" : "Preparing corpus"}
        </p>
        <p className="font-mono text-xs text-primary">
          {detail.progress_done}/{detail.progress_total}
        </p>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-strong"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={detail.progress_total}
        aria-valuenow={detail.progress_done}
        aria-label="Run progress"
      >
        <div
          className="h-full rounded-full bg-accent-violet transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </GlassCard>
  );
}

/** The run's configuration as instrument-labeled facts under the title. */
function RunFacts({
  detail,
  datasetName,
  ingestionName,
  retrievalName,
}: {
  detail: EvalRun;
  datasetName: string | null;
  ingestionName: string | null;
  retrievalName: string | null;
}) {
  const facts: Array<[string, string]> = [];
  if (datasetName) facts.push(["dataset", datasetName]);
  if (ingestionName) facts.push(["ingestion", ingestionName]);
  if (retrievalName) facts.push(["retrieval", retrievalName]);
  facts.push(["queries", String(detail.config.num_queries)]);
  facts.push(["distractors", String(detail.config.distractor_pool_size)]);
  facts.push(["seed", String(detail.config.seed)]);
  facts.push(["parallel", String(detail.config.concurrency)]);
  facts.push(["k", detail.config.k_values.join("/")]);
  return (
    <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {facts.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <dt className="font-mono text-[11px] uppercase tracking-[0.28em] text-meta">{label}</dt>
          <dd className="font-mono text-[11px] text-body">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
