"use client";

import { GitCompare } from "lucide-react";

import { CorpusRetryAction } from "@/components/evals/CorpusRetryAction";
import { FunnelPanel } from "@/components/evals/FunnelPanel";
import { useRunDetail } from "@/components/evals/hooks/use-run-detail";
import { ItemsTable } from "@/components/evals/ItemsTable";
import { runOutcome, runPhaseLabel } from "@/components/evals/lib/status";
import { formatDuration, runCost, runTokens } from "@/components/evals/lib/usage";
import { MetricCards } from "@/components/evals/MetricCards";
import { PageBody } from "@/components/ui/app-shell";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { CrumbBar } from "@/components/ui/crumb-bar";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Meter } from "@/components/ui/meter";
import { Panel } from "@/components/ui/panel";
import { PulseWire } from "@/components/ui/pulse-wire";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCount, formatUsd } from "@/lib/format";

import type { EvalRun } from "@/lib/types";

/**
 * One eval run: how it was configured, what it scored, where in the pipeline
 * the gold documents were lost, and the per-query record behind both.
 */
export function RunDetail({ runId }: { runId: string }) {
  const state = useRunDetail(runId);

  if (state.run.error) {
    return <RunPlaceholder error={state.run.error} />;
  }
  if (!state.run.data) {
    return <RunPlaceholder error={null} />;
  }
  return <RunView detail={state.run.data} {...state} />;
}

type RunViewProps = ReturnType<typeof useRunDetail> & { detail: EvalRun };

/** The resolved run: identity and cancel in the top bar, its record below. */
function RunView({
  detail,
  items,
  metricCatalog,
  dataset,
  pipelines,
  active,
  cancel,
  actionError,
}: RunViewProps) {
  const status = runOutcome(detail.status, detail.degraded_count);
  const name = detail.name || `Run ${detail.id.slice(0, 8)}`;
  const pipelineNames = new Map((pipelines.data ?? []).map((entry) => [entry.id, entry.name]));
  const catalog = metricCatalog.data ?? [];

  return (
    <>
      <CrumbBar
        crumbs={[{ label: "Evals", href: "/evals" }, { label: name }]}
        state={<StatusDot tone={status.tone} label={status.label} />}
        actions={
          <>
            {/* An in-flight run has nothing settled to compare yet. */}
            {!active && (
              <ButtonLink href={`/evals/compare?a=${detail.id}`}>
                <GitCompare className="h-3.5 w-3.5" aria-hidden />
                Compare
              </ButtonLink>
            )}
            {active && (
              <Button size="sm" variant="secondary" onClick={cancel}>
                Cancel run
              </Button>
            )}
          </>
        }
      />

      <PageBody className="flex flex-col gap-3">
        <RunFacts
          detail={detail}
          datasetName={dataset.data?.name ?? null}
          ingestionName={pipelineNames.get(detail.ingestion_pipeline_id) ?? null}
          retrievalName={pipelineNames.get(detail.retrieval_pipeline_id) ?? null}
        />

        <RunAlerts detail={detail} actionError={actionError} />

        {active && <ProgressCard detail={detail} />}

        <MetricCards aggregates={detail.aggregate_metrics} catalog={catalog} />
        <FunnelPanel funnel={detail.funnel} />
        <ItemsTable
          items={items.data?.items ?? []}
          documentTitles={items.data?.document_titles ?? {}}
          stages={detail.funnel.stages}
          kValues={detail.config.k_values}
          catalog={catalog}
        />
      </PageBody>
    </>
  );
}

/**
 * Everything that went wrong, rendered in place: a failed action, the run's own
 * terminal error, and the count of queries that never produced a score — which
 * is what makes the aggregates above a mean over fewer queries than requested.
 */
function RunAlerts({ detail, actionError }: { detail: EvalRun; actionError: string | null }) {
  return (
    <>
      {actionError && <p className="max-w-[66ch] text-ui text-data-neg">{actionError}</p>}
      {detail.error_message && (
        <p className="max-w-[66ch] text-ui text-data-neg">{detail.error_message}</p>
      )}
      {/* Amber like the unscored line below, and above it: a degraded query
          is still *in* the aggregates, so it is the one caveat a reader has to
          carry into every number on this page. */}
      {detail.degraded_count > 0 && (
        <p className="max-w-[66ch] text-ui text-data-warn">
          {detail.degraded_count} {detail.degraded_count === 1 ? "query ran" : "queries ran"} with a
          degraded node — a step passed its input through after its provider failed, so those
          queries scored a pipeline that only partly ran. Their metrics are included below. Open a
          query&apos;s trace to see which node degraded.
        </p>
      )}
      {detail.failed_count > 0 && (
        <p className="max-w-[66ch] text-ui text-data-neg">
          {detail.failed_count} of {detail.config.num_queries} queries failed to evaluate;
          aggregates are means over the remaining queries only.
        </p>
      )}
      {/* Separate from the failure line above on purpose: this is a corpus
          outcome, and reading it as retrieval quality is the whole bug. */}
      {detail.unscored_count > 0 && (
        <p className="max-w-[66ch] text-ui text-data-warn">
          {detail.unscored_count} {detail.unscored_count === 1 ? "query was" : "queries were"} not
          scored because no gold document reached the index. Those are ingestion failures, not
          retrieval misses, and the aggregates below exclude them.
        </p>
      )}
      {detail.coverage && detail.coverage.corpus_ingested < detail.coverage.corpus_total && (
        <p className="max-w-[66ch] text-ui text-data-warn">
          {detail.coverage.corpus_ingested} of {detail.coverage.corpus_total} corpus documents
          indexed. Retrieval was only ever able to return the documents that made it in.
        </p>
      )}
      {/* The corpus is the thing that can still be repaired — the run's own
          numbers are a record of what happened and never change. Gated on the
          read-time unindexed count rather than those numbers, so the action
          appears only while there is something to fix: a run that sampled part
          of the corpus is short of `corpus_total` by design. */}
      {detail.eval_collection_id && (detail.coverage?.corpus_unindexed ?? 0) > 0 && (
        <CorpusRetryAction collectionId={detail.eval_collection_id} />
      )}
    </>
  );
}

/**
 * The page before its run resolves: the failure in place, or a skeleton at the
 * run page's final geometry so the data lands without reflow.
 */
function RunPlaceholder({ error }: { error: string | null }) {
  return (
    <>
      <CrumbBar crumbs={[{ label: "Evals", href: "/evals" }, { label: "Run" }]} />
      <PageBody className="flex flex-col gap-3">
        {error ? (
          <p className="max-w-[66ch] text-ui text-data-neg">{error}</p>
        ) : (
          <>
            <Panel className="flex flex-wrap gap-x-4 gap-y-1 p-3" aria-busy>
              {[0, 1, 2, 3, 4].map((cell) => (
                <Skeleton key={cell} className="h-3 w-28" />
              ))}
              <span className="sr-only">Loading run</span>
            </Panel>
            <Panel className="h-28" />
            <Panel className="h-40" />
          </>
        )}
      </PageBody>
    </>
  );
}

/**
 * Live progress while the run provisions, ingests, or evaluates.
 *
 * Two live devices, each doing a different job: the pulse says data is moving
 * *now*, the determinate bar says how far. Both unmount when the run settles.
 */
function ProgressCard({ detail }: { detail: EvalRun }) {
  const phase = runPhaseLabel(detail.status);
  const percent =
    detail.progress_total > 0
      ? Math.round((detail.progress_done / detail.progress_total) * 100)
      : 0;
  return (
    <Panel className="shrink-0 overflow-hidden">
      <PulseWire label={phase} className="w-full" />
      <div className="flex items-baseline justify-between gap-3 px-3 pb-2 pt-2">
        <InstrumentLabel>{phase}</InstrumentLabel>
        <span className="font-mono text-ui tabular-nums text-primary">
          {detail.progress_done}/{detail.progress_total}
        </span>
      </div>
      <Meter
        value={percent / 100}
        label="Run progress"
        valueNow={detail.progress_done}
        valueMax={detail.progress_total}
        animate
        fillClassName="bg-accent-violet"
        className="mx-3 mb-3"
      />
    </Panel>
  );
}

/**
 * The run's configuration as one readout strip.
 *
 * A `Readout` row rather than a grid of cells: eight small facts about one
 * thing, where bordered boxes would be four container levels for eight values.
 */
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
  if (datasetName) facts.push(["Dataset", datasetName]);
  if (ingestionName) facts.push(["Ingestion", ingestionName]);
  if (retrievalName) facts.push(["Search tool", retrievalName]);
  facts.push(["Queries", detail.config.num_queries.toLocaleString()]);
  facts.push(["Distractors", detail.config.distractor_pool_size.toLocaleString()]);
  facts.push(["Seed", String(detail.config.seed)]);
  facts.push(["Parallel", String(detail.config.concurrency)]);
  facts.push(["k", detail.config.k_values.join("/")]);
  const duration = formatDuration(detail.created_at, detail.completed_at);
  if (duration) facts.push(["Duration", duration]);
  // Embedding spend the run actually performed. Tokens always; dollars only
  // where the model's provider publishes per-token pricing.
  const tokens = runTokens(detail.usage);
  if (tokens != null) facts.push(["Embedding tokens", formatCount(tokens)]);
  const cost = runCost(detail.usage);
  if (cost != null) facts.push(["Cost", formatUsd(cost)]);
  return (
    <Panel className="flex flex-wrap items-baseline gap-x-4 gap-y-1 p-3">
      {facts.map(([label, value]) => (
        <Readout key={label} label={label}>
          {value}
        </Readout>
      ))}
    </Panel>
  );
}
