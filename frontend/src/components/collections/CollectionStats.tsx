import { formatLatency } from "@/lib/format";
import { timeAgo } from "@/lib/utils";

import type { Collection, CollectionStats as CollectionStatsData } from "@/lib/types";

export type CollectionStatItem = {
  label: string;
  value: string;
};

/**
 * Shared "documents / chunks / avg latency / last updated / last used" summary
 * items rendered by both CollectionOverview and CollectionsList.
 */
export function buildCollectionStatItems(
  collection: Pick<Collection, "updated_at">,
  stats: CollectionStatsData | null | undefined,
): CollectionStatItem[] {
  return [
    {
      label: "Documents",
      value: stats?.document_count?.toLocaleString() ?? "0",
    },
    {
      label: "Chunks",
      value: stats?.chunk_count?.toLocaleString() ?? "0",
    },
    {
      label: "Avg latency",
      value: formatLatency(stats?.average_latency_ms),
    },
    {
      label: "Last updated",
      value: timeAgo(collection.updated_at),
    },
    {
      label: "Last used",
      value: stats?.last_used_at ? timeAgo(stats.last_used_at) : "n/a",
    },
  ];
}

type CollectionStatCardProps = {
  item: CollectionStatItem;
  valueClassName?: string;
};

/** Shared label-over-value markup for a single stats card. */
export function CollectionStatCard({
  item,
  valueClassName = "mt-2 text-2xl font-semibold text-white",
}: CollectionStatCardProps) {
  return (
    <>
      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{item.label}</p>
      <p className={valueClassName}>{item.value}</p>
    </>
  );
}
