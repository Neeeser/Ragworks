"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Readout } from "@/components/ui/readout";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTimeAgoCompact } from "@/lib/format";

import type { InsightOverview } from "@/lib/types";

export type InsightViewId = "map" | "graph" | "overlaps";

const VIEW_OPTIONS: Array<{ id: InsightViewId; label: string }> = [
  { id: "map", label: "Map" },
  { id: "graph", label: "Graph" },
  { id: "overlaps", label: "Overlaps" },
];

type InsightToolbarProps = {
  overview: InsightOverview;
  view: InsightViewId;
  onViewChange: (view: InsightViewId) => void;
  computing: boolean;
  onRefresh: () => void;
};

/**
 * The snapshot's own facts and the view switcher. There is deliberately no
 * compute button in the main flow — ingestion keeps the snapshot fresh in the
 * background — but a manual refit remains as the escape hatch for a layout
 * the user wants re-fitted now.
 */
export function InsightToolbar({
  overview,
  view,
  onViewChange,
  computing,
  onRefresh,
}: InsightToolbarProps) {
  const snapshot = overview.snapshot;
  const failed = overview.active?.status === "failed" ? overview.active : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-3 py-2">
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={view}
        onChange={onViewChange}
        aria-label="Insight view"
      />
      {snapshot ? (
        <>
          {/* Which space the views are drawn in — the one fact that changes
              what every distance on screen means. */}
          <Tooltip
            content={
              snapshot.space === "semantic"
                ? `Embedding space (${snapshot.space_label})`
                : "Lexical TF-IDF space built from the collection's own text"
            }
            side="bottom"
          >
            <Chip tone={snapshot.space === "semantic" ? "embed" : "index"}>
              {snapshot.space === "semantic" ? snapshot.space_label : "lexical · tf-idf"}
            </Chip>
          </Tooltip>
          <Readout label="Chunks">{snapshot.point_count.toLocaleString()}</Readout>
          <Readout label="Documents">{snapshot.document_count.toLocaleString()}</Readout>
          {snapshot.cluster_count > 0 ? (
            <Readout label="Clusters">{snapshot.cluster_count}</Readout>
          ) : null}
          {snapshot.coverage < 1 ? (
            <Tooltip
              content="Chunks the current space could place; the rest have no usable vector."
              side="bottom"
            >
              <Readout label="Coverage">{`${Math.round(snapshot.coverage * 100)}%`}</Readout>
            </Tooltip>
          ) : null}
          <Readout label="Updated">{formatTimeAgoCompact(snapshot.updated_at)}</Readout>
        </>
      ) : null}
      {failed ? (
        <Tooltip content={failed.error_message ?? "Computation failed."} side="bottom">
          <Chip tone="neg">compute failed</Chip>
        </Tooltip>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Tooltip
          content="Recompute the layout from scratch. Ingestion already keeps it fresh."
          side="bottom"
        >
          <Button variant="secondary" size="sm" onClick={onRefresh} loading={computing}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {computing ? "Computing" : "Refresh"}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/** The toolbar's geometry while the overview loads. */
export function InsightToolbarSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-hairline px-3 py-2">
      <Skeleton className="h-7 w-52 rounded-full" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-4 w-20" />
      <div className="ml-auto">
        <Skeleton className="h-7 w-24 rounded-control" />
      </div>
    </div>
  );
}
