"use client";

import { useMemo, useState } from "react";

import { TrendChart } from "@/components/collections/detail/overview/TrendChart";
import { GlassCard } from "@/components/ui/panel";
import { formatLatency } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { CollectionStatsHistoryPoint, LatencyBucket } from "@/lib/types";

type LatencyMetric = "avg_ms" | "p50_ms" | "p95_ms" | "max_ms";

const METRICS: Array<{ id: LatencyMetric; label: string }> = [
  { id: "avg_ms", label: "avg" },
  { id: "p50_ms", label: "p50" },
  { id: "p95_ms", label: "p95" },
  { id: "max_ms", label: "max" },
];

type FlowSummary = {
  requests: number;
  weightedAvg: number | null;
  worstP95: number | null;
};

function summarize(buckets: LatencyBucket[]): FlowSummary {
  let requests = 0;
  let weightedSum = 0;
  let worstP95: number | null = null;
  for (const bucket of buckets) {
    requests += bucket.count;
    if (bucket.avg_ms != null) {
      weightedSum += bucket.avg_ms * bucket.count;
    }
    if (bucket.p95_ms != null) {
      worstP95 = worstP95 === null ? bucket.p95_ms : Math.max(worstP95, bucket.p95_ms);
    }
  }
  return {
    requests,
    weightedAvg: requests > 0 ? weightedSum / requests : null,
    worstP95,
  };
}

type LatencyCardProps = {
  points: CollectionStatsHistoryPoint[];
  granularity: "hour" | "day";
};

/**
 * Ingestion vs retrieval latency over time. The collapsed view charts
 * per-bucket averages; "Details" adds percentile series and per-flow window
 * summaries.
 */
export function LatencyCard({ points, granularity }: LatencyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [metric, setMetric] = useState<LatencyMetric>("avg_ms");

  const buckets = useMemo(() => points.map((point) => point.bucket_start), [points]);
  const activeMetric = expanded ? metric : "avg_ms";
  const series = useMemo(
    () => [
      {
        id: "ingestion",
        label: "Ingestion",
        color: "violet" as const,
        values: points.map((point) => point.ingestion[activeMetric] ?? null),
      },
      {
        id: "retrieval",
        label: "Retrieval",
        color: "cyan" as const,
        values: points.map((point) => point.retrieval[activeMetric] ?? null),
      },
    ],
    [points, activeMetric],
  );

  const ingestion = useMemo(() => summarize(points.map((point) => point.ingestion)), [points]);
  const retrieval = useMemo(() => summarize(points.map((point) => point.retrieval)), [points]);
  const hasSamples = ingestion.requests > 0 || retrieval.requests > 0;

  return (
    <GlassCard className="rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">Latency</p>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="rounded-full border border-hairline px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-violet" aria-hidden />
            Ingestion
          </p>
          <p className="text-2xl font-semibold tracking-tight text-primary">
            {formatLatency(ingestion.weightedAvg)}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="inline-block h-2 w-2 rounded-full bg-accent-cyan" aria-hidden />
            Retrieval
          </p>
          <p className="text-2xl font-semibold tracking-tight text-primary">
            {formatLatency(retrieval.weightedAvg)}
          </p>
        </div>
      </div>

      {hasSamples ? (
        <TrendChart
          className="mt-4"
          buckets={buckets}
          granularity={granularity}
          height={128}
          series={series}
          formatValue={(value) => formatLatency(value)}
        />
      ) : (
        <p className="mt-4 text-sm text-muted">No runs or queries in this window yet.</p>
      )}

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-hairline pt-4">
          <div
            role="group"
            aria-label="Latency metric"
            className="inline-flex rounded-full border border-hairline p-0.5"
          >
            {METRICS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setMetric(entry.id)}
                aria-pressed={metric === entry.id}
                className={cn(
                  "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  metric === entry.id
                    ? "bg-accent-violet/15 text-primary"
                    : "text-muted hover:text-primary",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { label: "Ingestion", summary: ingestion },
                { label: "Retrieval", summary: retrieval },
              ] as const
            ).map(({ label, summary }) => (
              <div key={label} className="rounded-2xl border border-hairline bg-surface p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  {label}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Runs in window</dt>
                    <dd className="text-primary">{summary.requests.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Window average</dt>
                    <dd className="text-primary">{formatLatency(summary.weightedAvg)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Worst p95</dt>
                    <dd className="text-primary">{formatLatency(summary.worstP95)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
