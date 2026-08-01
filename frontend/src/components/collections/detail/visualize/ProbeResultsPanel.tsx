"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/lib/use-media-query";

import type { InsightProbeResult } from "@/lib/types";

type ProbeResultsPanelProps = {
  probe: InsightProbeResult;
  onSelectMatch: (chunkId: string) => void;
  onClose: () => void;
};

/**
 * What sits closest to the probed query, ranked by exact similarity in the
 * snapshot's space. Clicking a row docks that chunk's text in its place.
 *
 * Desktop-only as a pane; below `lg` the map keeps the full width and the
 * ranked matches stay reachable through their halos on the canvas.
 */
export function ProbeResultsPanel({ probe, onSelectMatch, onClose }: ProbeResultsPanelProps) {
  const titleId = useId();
  const isDesktop = useMediaQuery("(min-width: 1024px)", true);
  if (!isDesktop) {
    return null;
  }

  return (
    <aside
      aria-labelledby={titleId}
      className="hidden w-[340px] shrink-0 flex-col border-l border-hairline bg-surface lg:flex"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <h3 id={titleId} className="min-w-0 flex-1 truncate text-ui font-medium text-primary">
          Nearest chunks
        </h3>
        <Tooltip content="Clear probe" side="left">
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Clear probe">
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {probe.matches.map((match) => (
          <li key={match.chunk_id} className="border-b border-hairline">
            <button
              type="button"
              onClick={() => onSelectMatch(match.chunk_id)}
              className="flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors duration-80 ease-standard hover:bg-surface-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet"
            >
              <span className="flex w-full items-baseline gap-2">
                <span className="font-mono text-instrument tabular-nums text-accent-cyan">
                  {match.similarity.toFixed(3)}
                </span>
                <span className="min-w-0 flex-1 truncate text-ui text-primary">
                  {match.document_name}
                </span>
                <span className="font-mono text-instrument tabular-nums text-meta">
                  #{match.chunk_index}
                </span>
              </span>
              <span className="line-clamp-2 text-instrument text-muted">{match.text_snippet}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
