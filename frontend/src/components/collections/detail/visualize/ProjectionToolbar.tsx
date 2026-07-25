"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Readout } from "@/components/ui/readout";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip } from "@/components/ui/tooltip";
import { parseApiDate } from "@/lib/datetime";
import { formatTimeAgoCompact } from "@/lib/format";

import type { UmapProjection } from "@/lib/types";

type ProjectionToolbarProps = {
  /** The stored projection, or null when none has been computed yet. */
  projection: UmapProjection | null;
  computing: boolean;
  onRefresh: () => void;
  onCompute: () => void;
};

/**
 * The projection's own facts, and the two things you can do to it.
 *
 * The parameters a UMAP layout depends on — neighbourhood size, minimum
 * distance, metric — decide what the plot below means, and they were previously
 * only in the API response. They read as one instrument readout rather than a
 * KPI strip: six small facts about one object, on one line, so the canvas keeps
 * the height.
 */
export function ProjectionToolbar({
  projection,
  computing,
  onRefresh,
  onCompute,
}: ProjectionToolbarProps) {
  const computedAt = projection ? parseApiDate(projection.created_at) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-3 py-2">
      {projection ? (
        <>
          <Readout label="Points">{projection.point_count.toLocaleString()}</Readout>
          <Tooltip content={projection.embedding_model} side="bottom" triggerClassName="min-w-0">
            <Readout label="Model">{projection.embedding_model}</Readout>
          </Tooltip>
          <Readout label="Neighbors">{projection.n_neighbors}</Readout>
          <Readout label="Min dist">{projection.min_dist}</Readout>
          <Readout label="Metric">{projection.metric}</Readout>
          {/* Tooltips in this row open downward: it is the card's top edge, and
              the card clips its own overflow. */}
          <Tooltip content={computedAt?.toLocaleString() ?? ""} side="bottom">
            <Readout label="Computed">{formatTimeAgoCompact(projection.created_at)}</Readout>
          </Tooltip>
        </>
      ) : null}
      {/* No "No projection stored." line here: the plot area's empty state
          already says it — stating it twice on one screen is the text rule
          failing. The toolbar's job without a projection is just the actions. */}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
        {/* The page's one primary action, so it is the only thing here that glows. */}
        <Button size="sm" glow onClick={onCompute} loading={computing}>
          {projection ? "Recompute UMAP" : "Compute UMAP"}
        </Button>
      </div>
    </div>
  );
}

/** The toolbar's geometry while the stored projection loads. */
export function ProjectionToolbarSkeleton() {
  return (
    <div className="flex items-center gap-4 border-b border-hairline px-3 py-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-28" />
      <div className="ml-auto flex items-center gap-1">
        <Skeleton className="h-7 w-20 rounded-control" />
        <Skeleton className="h-7 w-32 rounded-control" />
      </div>
    </div>
  );
}
