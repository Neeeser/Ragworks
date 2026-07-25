"use client";

import { TabList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { TraceStage } from "@/components/traces/trace-graph";
import type { TabItem } from "@/components/ui/tabs";

type TraceGraphToolbarProps = {
  /** End-to-end traces carry both bands, so the stage switch only exists then. */
  combined: boolean;
  graphStage: TraceStage;
  onStageChange: (stage: TraceStage) => void;
  focused: boolean;
  showFocusedPath: boolean;
  onShowFocusedPath: (show: boolean) => void;
};

const STAGE_TABS: Array<TabItem<TraceStage>> = [
  { id: "origin", label: "Ingestion" },
  { id: "retrieval", label: "Retrieval" },
];

/** Floating chrome shares one shape: a pill group lifted off the canvas. */
const GROUP_CLASS =
  "rounded-full border border-hairline bg-canvas-raised shadow-elevation-2 p-1 gap-1";

const PILL_CLASS =
  "rounded-full px-3 py-1 text-instrument font-medium transition-colors duration-80 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The graph pane's floating controls: which band of an end-to-end trace is on
 * the canvas, and whether the canvas is dimmed to the focused result's path.
 *
 * They float over the canvas rather than taking a toolbar row because the graph
 * is the working pane — every pixel it gives up is a node the user cannot see.
 */
export function TraceGraphToolbar({
  combined,
  graphStage,
  onStageChange,
  focused,
  showFocusedPath,
  onShowFocusedPath,
}: TraceGraphToolbarProps) {
  return (
    <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
      {combined ? (
        <TabList
          tabs={STAGE_TABS}
          active={graphStage}
          onSelect={onStageChange}
          label="Trace stage"
          wrap
          className={GROUP_CLASS}
        />
      ) : null}
      <div className={cn("flex items-center", GROUP_CLASS)}>
        <button
          type="button"
          aria-pressed={showFocusedPath && focused}
          onClick={() => onShowFocusedPath(true)}
          disabled={!focused}
          className={cn(
            PILL_CLASS,
            showFocusedPath && focused ? "bg-surface-strong text-primary" : "text-muted",
          )}
        >
          Focused path
        </button>
        <button
          type="button"
          aria-pressed={!showFocusedPath}
          onClick={() => onShowFocusedPath(false)}
          className={cn(
            PILL_CLASS,
            !showFocusedPath ? "bg-surface-strong text-primary" : "text-muted",
          )}
        >
          Full graph
        </button>
      </div>
    </div>
  );
}
