"use client";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SERIES_TOKENS } from "./lib/document-series";

import type { DocumentSeries } from "./lib/document-series";

type DocumentLegendProps = {
  series: DocumentSeries[];
  className?: string;
};

/**
 * The plane's key: which colour is which document, and how many chunks each
 * contributed.
 *
 * It docks over the plot rather than beside it, so it costs the plane no
 * layout width at any viewport — the plot is the one element on this page that
 * uses every pixel it is given. Its own height is capped and it scrolls
 * internally, because a collection can hold far more documents than fit.
 *
 * Colour alone never carries identity here: past six documents the series slots
 * cycle, so this list is what disambiguates a repeated colour, and it is also
 * the visible-label relief the darkest series slots need on the lifted palettes.
 */
export function DocumentLegend({ series, className }: DocumentLegendProps) {
  if (series.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        popoverSurfaceClass,
        "absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-[min(15rem,45%)]",
        "flex flex-col overflow-hidden",
        className,
      )}
    >
      {/* Both columns are named, because a bare number beside a filename reads
          as anything — a size, a rank, a score. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-2 py-1 text-instrument font-medium text-muted">
        <span className="min-w-0 flex-1 truncate">Source document</span>
        <span className="shrink-0">Chunks</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {series.map((entry) => (
          <li key={entry.documentId} className="flex items-center gap-2 px-2 py-1">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: `var(${SERIES_TOKENS[entry.seriesIndex]})` }}
            />
            {/* A document name is a literal and often longer than the strip,
                so the full value stays reachable on hover rather than through
                a `title` the theme cannot reach. */}
            <Tooltip content={entry.name} side="left" triggerClassName="min-w-0 flex-1">
              <span className="min-w-0 flex-1 truncate text-instrument text-body">
                {entry.name}
              </span>
            </Tooltip>
            <span className="shrink-0 font-mono text-instrument tabular-nums text-muted">
              {entry.chunkCount.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
