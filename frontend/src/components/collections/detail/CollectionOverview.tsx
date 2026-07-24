"use client";

import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { DiagnosticsCard } from "@/components/collections/detail/overview/DiagnosticsCard";
import { LatencyCard } from "@/components/collections/detail/overview/LatencyCard";
import { PipelinesCard } from "@/components/collections/detail/overview/PipelinesCard";
import { RangePicker } from "@/components/collections/detail/overview/RangePicker";
import { StatTrendCard } from "@/components/collections/detail/overview/StatTrendCard";
import { ToolsPanel } from "@/components/collections/detail/overview/ToolsPanel";
import { GlassCard } from "@/components/ui/panel";
import { fetchCollectionStatsHistory } from "@/lib/api";
import { formatDate } from "@/lib/datetime";
import { useApiQuery } from "@/lib/use-api-query";
import { timeAgo } from "@/lib/utils";

import type { Collection, CollectionStats, Pipeline, StatsHistoryRange } from "@/lib/types";

type CollectionOverviewProps = {
  collection: Collection;
  stats: CollectionStats | null;
  ingestionPipelines: Pipeline[];
  retrievalPipelines: Pipeline[];
  token: string;
  onCollectionUpdated: (collection: Collection) => void;
};

function MetaEntry({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-meta">{label}</p>
      <p className="mt-0.5 text-sm text-body">{value}</p>
    </div>
  );
}

export function CollectionOverview({
  collection,
  stats,
  ingestionPipelines,
  retrievalPipelines,
  token,
  onCollectionUpdated,
}: CollectionOverviewProps) {
  const [copied, setCopied] = useState(false);
  const [range, setRange] = useState<StatsHistoryRange>("7d");

  const history = useApiQuery(
    () => fetchCollectionStatsHistory(token, collection.id, range),
    [token, collection.id, range],
  );

  const points = useMemo(() => history.data?.points ?? [], [history.data]);
  const buckets = useMemo(() => points.map((point) => point.bucket_start), [points]);
  const granularity = history.data?.bucket ?? (range === "4h" || range === "24h" ? "hour" : "day");

  const copyId = async () => {
    await navigator.clipboard.writeText(collection.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <GlassCard className="rounded-3xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-primary text-balance">
          {collection.name}
        </h1>
        {collection.description?.trim() && (
          <p className="mt-1 text-sm text-body leading-relaxed text-pretty">
            {collection.description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 border-t border-hairline pt-4">
          <MetaEntry label="Created" value={formatDate(collection.created_at)} />
          <MetaEntry label="Last updated" value={timeAgo(collection.updated_at)} />
          <MetaEntry
            label="Last used"
            value={stats?.last_used_at ? timeAgo(stats.last_used_at) : "Never"}
          />
          <button
            type="button"
            onClick={copyId}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted transition hover:border-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {copied ? (
              <Check className="h-3 w-3 text-data-pos" aria-hidden />
            ) : (
              <Copy className="h-3 w-3" aria-hidden />
            )}
            {copied ? "Copied" : "Copy id"}
          </button>
        </div>
      </GlassCard>

      {history.error && (
        <GlassCard className="rounded-3xl border border-hairline p-4 text-sm text-body">
          {history.error}
        </GlassCard>
      )}

      <div className="flex justify-end">
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <StatTrendCard
          label="Documents"
          total={stats?.document_count ?? points[points.length - 1]?.document_total ?? 0}
          buckets={buckets}
          granularity={granularity}
          values={points.map((point) => point.document_total)}
        />
        <StatTrendCard
          label="Chunks"
          total={stats?.chunk_count ?? points[points.length - 1]?.chunk_total ?? 0}
          buckets={buckets}
          granularity={granularity}
          values={points.map((point) => point.chunk_total)}
        />
      </div>

      <LatencyCard points={points} granularity={granularity} />

      <DiagnosticsCard collectionId={collection.id} token={token} />

      <PipelinesCard
        collection={collection}
        ingestionPipelines={ingestionPipelines}
        retrievalPipelines={retrievalPipelines}
        token={token}
        onCollectionUpdated={onCollectionUpdated}
      />

      <ToolsPanel
        collection={collection}
        toolPipelines={retrievalPipelines}
        token={token}
        onCollectionUpdated={onCollectionUpdated}
      />
    </div>
  );
}
