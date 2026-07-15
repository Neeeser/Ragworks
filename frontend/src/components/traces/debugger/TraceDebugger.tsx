"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { FocusHeader } from "@/components/traces/debugger/FocusHeader";
import { useTraceDebugger } from "@/components/traces/debugger/hooks/use-trace-debugger";
import { useTraceStepper } from "@/components/traces/debugger/hooks/use-trace-stepper";
import { InspectorPanel } from "@/components/traces/debugger/InspectorPanel";
import { JourneyTimeline } from "@/components/traces/debugger/JourneyTimeline";
import { StepRail } from "@/components/traces/debugger/StepRail";
import { TraceHeader } from "@/components/traces/debugger/TraceHeader";
import { traceNodeTypes } from "@/components/traces/IndexStoreNode";
import { buildJourneyFocus, buildJourneySections } from "@/components/traces/lib/journey";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";

import type { TypedEdgeData } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { TraceSource } from "@/components/traces/debugger/hooks/use-trace-debugger";
import type { TraceGraph } from "@/components/traces/trace-graph";
import type { PipelineTraceResponse, TraceFocusedItem } from "@/lib/types";

type TraceDebuggerProps = {
  source: TraceSource;
};

const tracePath = (source: TraceSource): string => {
  if (source.kind === "query") return `/traces/queries/${source.id}`;
  if (source.kind === "document") return `/traces/documents/${source.id}`;
  return `/traces/runs/${source.id}`;
};

/**
 * Full-page pipeline debugger with two modes on one page. Run-level (no
 * focused item): step rail, flow graph, and node inspector around one shared
 * playback state. Focused (`?chunk=`): the result's journey timeline drives
 * the page, the camera follows the active node, and the inspector detail
 * lives inside the active journey card.
 */
export function TraceDebugger({ source }: TraceDebuggerProps) {
  const router = useRouter();
  const {
    graph,
    trace,
    error,
    reload,
    specsNotice,
    focusedItemId,
    focusedItem,
    focusItem,
    clearFocus,
  } = useTraceDebugger(source);
  const selectItem = (itemId: string) => {
    focusItem(itemId);
    router.replace(`${tracePath(source)}?chunk=${encodeURIComponent(itemId)}`);
  };
  const clearItem = () => {
    clearFocus();
    router.replace(tracePath(source));
  };

  if (!graph || !trace) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-hairline bg-canvas-raised">
        {error ? (
          <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted">
              Trace unavailable
            </p>
            <p className="text-sm text-body">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => router.back()} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
          </div>
        ) : (
          <Loader className="h-6 w-6" />
        )}
      </div>
    );
  }

  return (
    <LoadedTraceDebugger
      graph={graph}
      trace={trace}
      focusedItemId={focusedItemId}
      focusedItem={focusedItem}
      specsNotice={specsNotice}
      onFocusItem={selectItem}
      onClearFocus={clearItem}
      onRefresh={reload}
    />
  );
}

type LoadedTraceDebuggerProps = {
  graph: TraceGraph;
  trace: PipelineTraceResponse;
  focusedItemId: string | null;
  focusedItem: TraceFocusedItem | null;
  specsNotice: string | null;
  onFocusItem: (itemId: string) => void;
  onClearFocus: () => void;
  onRefresh: () => void;
};

const nodeItemFocus = (
  nodeId: string,
  traveled: ReadonlySet<string>,
  absent: ReadonlySet<string>,
  focusedStores: ReadonlySet<string>,
): PipelineNodeData["itemFocus"] => {
  if (traveled.has(nodeId) || focusedStores.has(nodeId)) return "traveled";
  if (absent.has(nodeId)) return "absent";
  return undefined;
};

const edgeItemFocus = (
  edgeId: string,
  traveled: ReadonlySet<string>,
  absent: ReadonlySet<string>,
): TypedEdgeData["itemFocus"] => {
  if (traveled.has(edgeId)) return "traveled";
  if (absent.has(edgeId)) return "absent";
  return undefined;
};

/** Mounted only once the graph exists, so the stepper can seed itself from it. */
function LoadedTraceDebugger({
  graph,
  trace,
  focusedItemId,
  focusedItem,
  specsNotice,
  onFocusItem,
  onClearFocus,
  onRefresh,
}: LoadedTraceDebuggerProps) {
  const { playback, activeStep } = useTraceStepper(graph);
  const sections = useMemo(
    () => buildJourneySections(graph, focusedItemId),
    [graph, focusedItemId],
  );
  const journey = useMemo(() => sections.flatMap((section) => section.steps), [sections]);
  const displayGraph = useMemo(() => {
    if (!focusedItemId) return graph;
    const focus = buildJourneyFocus(graph, journey);
    const focusedStores = new Set(
      graph.edges.flatMap((edge) =>
        focus.traveledEdgeIds.has(edge.id)
          ? [edge.source, edge.target].filter((id) => focus.storeNodeIds.has(id))
          : [],
      ),
    );
    return {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          itemFocus: nodeItemFocus(
            node.id,
            focus.traveledNodeIds,
            focus.absentNodeIds,
            focusedStores,
          ),
        },
      })),
      edges: graph.edges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          itemFocus: edgeItemFocus(edge.id, focus.traveledEdgeIds, focus.absentEdgeIds),
        },
      })),
    };
  }, [focusedItemId, graph, journey]);

  const traceStepsByNodeId = useMemo(
    () => new Map(graph.steps.map((step) => [step.nodeId, step])),
    [graph.steps],
  );
  // The journey cards' positions inside the shared playback order, so the
  // timeline's ◀ ▶ hop between item-carrying nodes instead of every node.
  const journeyStepIndices = useMemo(
    () =>
      journey
        .map((card) => graph.steps.findIndex((step) => step.nodeId === card.nodeId))
        .filter((index) => index >= 0),
    [journey, graph.steps],
  );

  const selectJourneyNode = (nodeId: string) => {
    const index = graph.steps.findIndex((step) => step.nodeId === nodeId);
    if (index >= 0) playback.seek(index);
  };
  const stepJourneyForward = () => {
    const next = journeyStepIndices.find((index) => index > playback.activeIndex);
    if (next !== undefined) playback.seek(next);
  };
  const stepJourneyBack = () => {
    const prev = [...journeyStepIndices].reverse().find((index) => index < playback.activeIndex);
    if (prev !== undefined) playback.seek(prev);
  };

  const focused = Boolean(focusedItemId);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-canvas-raised">
      <TraceHeader trace={trace} combined={graph.combined} onRefresh={onRefresh} />
      {specsNotice && (
        <div className="shrink-0 border-b border-data-warn/30 bg-data-warn/10 px-4 py-1.5 text-xs text-data-warn">
          {specsNotice}
        </div>
      )}
      {focused && focusedItemId ? (
        <FocusHeader
          focusedItemId={focusedItemId}
          focusedItem={focusedItem}
          ingestionOnly={trace.run.kind === "ingestion" && !graph.combined}
          onClearFocus={onClearFocus}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className={
            focused
              ? "order-2 min-h-0 shrink-0 border-t border-hairline md:order-1 md:w-[26rem] md:border-r md:border-t-0"
              : "order-2 min-h-0 shrink-0 border-t border-hairline md:order-1 md:w-64 md:border-r md:border-t-0"
          }
        >
          {focused && focusedItemId ? (
            <JourneyTimeline
              sections={sections}
              traceStepsByNodeId={traceStepsByNodeId}
              activeNodeId={activeStep?.nodeId ?? null}
              focusedItemId={focusedItemId}
              onSelectNode={selectJourneyNode}
              onFocusItem={onFocusItem}
              onStepBack={stepJourneyBack}
              onStepForward={stepJourneyForward}
            />
          ) : (
            <StepRail
              steps={graph.steps}
              activeIndex={playback.activeIndex}
              onSelect={playback.seek}
            />
          )}
        </div>
        <div className="order-1 min-h-0 min-w-0 flex-1 md:order-2">
          <FlowPlayer
            nodes={displayGraph.nodes}
            edges={displayGraph.edges}
            steps={graph.steps}
            playback={playback}
            nodeTypes={graph.combined ? traceNodeTypes : undefined}
            fitViewPadding={0.18}
            centerNodeId={focused ? (activeStep?.nodeId ?? null) : undefined}
          />
        </div>
      </div>
      {!focused ? (
        <div className="h-[38%] min-h-[220px] shrink-0 border-t border-hairline">
          <InspectorPanel
            key={playback.activeIndex}
            step={activeStep}
            focusedItemId={focusedItemId}
            onFocusItem={onFocusItem}
          />
        </div>
      ) : null}
    </div>
  );
}
