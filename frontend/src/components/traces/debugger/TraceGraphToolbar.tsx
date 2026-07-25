"use client";

import { TabList } from "@/components/ui/tabs";

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

type ScopeTab = "focused" | "full";

/** Floating chrome shares one shape: a pill group lifted off the canvas. */
const GROUP_CLASS =
  "rounded-full border border-hairline bg-canvas-raised shadow-elevation-2 p-1 gap-1";

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
  const scopeTabs: Array<TabItem<ScopeTab>> = [
    {
      id: "focused",
      label: "Focused path",
      disabled: !focused,
      disabledReason: focused ? undefined : "Focus a result to dim the canvas to its path.",
    },
    { id: "full", label: "Full graph" },
  ];

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
      <TabList<ScopeTab>
        tabs={scopeTabs}
        active={showFocusedPath && focused ? "focused" : "full"}
        onSelect={(id) => onShowFocusedPath(id === "focused")}
        label="Graph scope"
        wrap
        className={GROUP_CLASS}
      />
    </div>
  );
}
