"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";

import { FlowPlayer } from "@/components/pipelines/flow/FlowPlayer";
import { ArtifactDrawer } from "@/components/traces/debugger/ArtifactDrawer";
import { ExecutionLedger } from "@/components/traces/debugger/ExecutionLedger";
import { FocusHeader } from "@/components/traces/debugger/FocusHeader";
import { useExecutionSelection } from "@/components/traces/debugger/hooks/use-execution-selection";
import { useTraceDebugger } from "@/components/traces/debugger/hooks/use-trace-debugger";
import { useTraceStepper } from "@/components/traces/debugger/hooks/use-trace-stepper";
import { NodeEvidencePanel } from "@/components/traces/debugger/NodeEvidencePanel";
import { RankPath } from "@/components/traces/debugger/RankPath";
import { TraceHeader } from "@/components/traces/debugger/TraceHeader";
import { buildExecutionSections, traceQueryText } from "@/components/traces/lib/execution";
import { buildJourneyFocus } from "@/components/traces/lib/journey";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

import type { TypedEdgeData } from "@/components/pipelines/flow/TypedEdge";
import type { PipelineNodeData } from "@/components/pipelines/PipelineNode";
import type { TraceSource } from "@/components/traces/debugger/hooks/use-trace-debugger";
import type { TraceGraph, TraceStage } from "@/components/traces/trace-graph";
import type { PipelineTraceResponse, TraceFocusedItem } from "@/lib/types";

type TraceDebuggerProps = {
  source: TraceSource;
};

const ACTIVE_TOGGLE_CLASS = "bg-surface-strong text-primary";
const INACTIVE_TOGGLE_CLASS = "text-muted";

const tracePath = (source: TraceSource): string => {
  if (source.kind === "query") return `/traces/queries/${source.id}`;
  if (source.kind === "document") return `/traces/documents/${source.id}`;
  return `/traces/runs/${source.id}`;
};

/** Full-page debugger with a compact graph, execution ledger, and evidence pane. */
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
    contextItems,
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
      contextItems={contextItems}
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
  contextItems: TraceFocusedItem[];
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
  contextItems,
  specsNotice,
  onFocusItem,
  onClearFocus,
  onRefresh,
}: LoadedTraceDebuggerProps) {
  const { playback, activeStep } = useTraceStepper(graph);
  const focused = Boolean(focusedItemId);
  const { selectedNodeId, selectedStep, selectNode } = useExecutionSelection(graph, focused);
  const [showFocusedPath, setShowFocusedPath] = useState(focused);
  const [graphStage, setGraphStage] = useState<TraceStage>(
    activeStep?.stage ?? graph.steps[0]?.stage ?? "retrieval",
  );
  const followedPlaybackIndex = useRef(playback.activeIndex);
  const [artifactItem, setArtifactItem] = useState<TraceFocusedItem | null>(null);
  const [artifactMode, setArtifactMode] = useState<"reader" | "context">("reader");
  const openArtifact = (item: TraceFocusedItem) => {
    setArtifactMode("reader");
    setArtifactItem(item);
  };
  const focusResult = (itemId: string) => {
    setShowFocusedPath(true);
    onFocusItem(itemId);
  };
  const clearResult = () => {
    setShowFocusedPath(false);
    setArtifactItem(null);
    onClearFocus();
  };
  const selectTraceNode = useCallback(
    (nodeId: string) => {
      const stage = graph.steps.find((step) => step.nodeIds.includes(nodeId))?.stage;
      if (stage) setGraphStage(stage);
      selectNode(nodeId);
    },
    [graph.steps, selectNode],
  );
  const followPlaybackStage = useCallback(
    (index: number) => {
      if (index === followedPlaybackIndex.current) return;
      followedPlaybackIndex.current = index;
      const stage = graph.steps[index]?.stage;
      if (stage) setGraphStage(stage);
    },
    [graph.steps],
  );
  const sections = useMemo(
    () => buildExecutionSections(graph, focusedItemId),
    [graph, focusedItemId],
  );
  const query = useMemo(() => traceQueryText(graph), [graph]);
  const itemEffects = useMemo(
    () => sections.flatMap((section) => section.entries.flatMap((entry) => entry.itemEffect ?? [])),
    [sections],
  );
  const rankPath = useMemo(
    () =>
      sections.flatMap((section) =>
        section.stage === "retrieval"
          ? section.entries.flatMap((entry) =>
              entry.itemEffect &&
              entry.itemEffect.role !== "chunks" &&
              entry.itemEffect.rank !== null
                ? [entry.itemEffect]
                : [],
            )
          : [],
      ),
    [sections],
  );
  const hasAdjacentContext = useMemo(
    () =>
      Boolean(
        focusedItem &&
        contextItems.some(
          (item) =>
            item.document_id === focusedItem.document_id &&
            item.id !== focusedItem.id &&
            item.chunk_index !== null &&
            item.chunk_index !== undefined,
        ),
      ),
    [contextItems, focusedItem],
  );
  const displayGraph = useMemo(() => {
    const stageNodeIds = new Set(
      graph.steps.filter((step) => step.stage === graphStage).flatMap((step) => step.nodeIds),
    );
    const focus = buildJourneyFocus(graph, showFocusedPath ? itemEffects : []);
    const focusedStores = new Set(
      graph.edges.flatMap((edge) =>
        focus.traveledEdgeIds.has(edge.id)
          ? [edge.source, edge.target].filter((id) => focus.storeNodeIds.has(id))
          : [],
      ),
    );
    return {
      ...graph,
      nodes: graph.nodes
        .filter((node) => stageNodeIds.has(node.id))
        .map((node) => ({
          ...node,
          data: {
            ...node.data,
            active: node.id === selectedNodeId,
            itemFocus: nodeItemFocus(
              node.id,
              focus.traveledNodeIds,
              focus.absentNodeIds,
              focusedStores,
            ),
          },
        })),
      edges: graph.edges
        .filter((edge) => stageNodeIds.has(edge.source) && stageNodeIds.has(edge.target))
        .map((edge) => ({
          ...edge,
          data: {
            ...edge.data,
            itemFocus: edgeItemFocus(edge.id, focus.traveledEdgeIds, focus.absentEdgeIds),
          },
        })),
    };
  }, [graph, graphStage, itemEffects, selectedNodeId, showFocusedPath]);
  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId],
  );
  const selectedEffect = useMemo(
    () =>
      sections
        .flatMap((section) => section.entries)
        .find((entry) => entry.nodeId === selectedNodeId)?.itemEffect ?? null,
    [sections, selectedNodeId],
  );
  const inputSources = useMemo(() => {
    const labelsById = new Map(graph.nodes.map((node) => [node.id, node.data.label]));
    return graph.edges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => labelsById.get(edge.source) ?? edge.source);
  }, [graph.edges, graph.nodes, selectedNodeId]);

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
          query={query}
          ingestionOnly={trace.run.trigger === "ingest" && !graph.combined}
          onOpenArtifact={() => focusedItem && openArtifact(focusedItem)}
          onCompareContext={
            hasAdjacentContext
              ? () => {
                  setArtifactMode("context");
                  if (focusedItem) setArtifactItem(focusedItem);
                }
              : undefined
          }
          onClearFocus={clearResult}
        />
      ) : null}
      {focused ? (
        <RankPath steps={rankPath} selectedNodeId={selectedNodeId} onSelectNode={selectTraceNode} />
      ) : null}
      <section
        aria-label="Trace graph"
        className="relative h-[clamp(180px,28vh,280px)] shrink-0 border-b border-hairline bg-canvas"
      >
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
          {graph.combined ? (
            <div
              role="tablist"
              aria-label="Trace stage"
              className="flex items-center gap-1 rounded-full border border-hairline bg-canvas-raised/90 p-1 shadow-elevation-1"
            >
              {(["origin", "retrieval"] as const).map((stage) => {
                const label = stage === "origin" ? "Ingestion" : "Retrieval";
                return (
                  <button
                    key={stage}
                    type="button"
                    role="tab"
                    aria-selected={graphStage === stage}
                    onClick={() => setGraphStage(stage)}
                    className={cn(
                      "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-violet",
                      graphStage === stage ? ACTIVE_TOGGLE_CLASS : INACTIVE_TOGGLE_CLASS,
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex items-center gap-1 rounded-full border border-hairline bg-canvas-raised/90 p-1 shadow-elevation-1">
            <button
              type="button"
              onClick={() => setShowFocusedPath(true)}
              disabled={!focused}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition disabled:cursor-not-allowed disabled:opacity-40",
                showFocusedPath && focused ? ACTIVE_TOGGLE_CLASS : INACTIVE_TOGGLE_CLASS,
              )}
            >
              Focused path
            </button>
            <button
              type="button"
              onClick={() => setShowFocusedPath(false)}
              className={cn(
                "rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] transition",
                !showFocusedPath ? ACTIVE_TOGGLE_CLASS : INACTIVE_TOGGLE_CLASS,
              )}
            >
              Full graph
            </button>
          </div>
        </div>
        <div className="h-full min-h-0 min-w-0">
          <FlowPlayer
            nodes={displayGraph.nodes}
            edges={displayGraph.edges}
            steps={graph.steps}
            playback={playback}
            fitViewPadding={0.18}
            minZoom={0.1}
            compact
            interactive
            onActiveStepChange={followPlaybackStage}
            onNodeSelect={selectTraceNode}
          />
        </div>
      </section>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="max-h-[260px] min-h-[180px] shrink-0 border-b border-hairline lg:max-h-none lg:min-h-0 lg:w-[22rem] lg:border-b-0">
          <ExecutionLedger
            sections={sections}
            selectedNodeId={selectedNodeId}
            playbackNodeId={activeStep?.nodeId ?? null}
            onSelectNode={selectTraceNode}
          />
        </div>
        <div className="min-h-[280px] min-w-0 flex-1 lg:min-h-0">
          <NodeEvidencePanel
            key={selectedNodeId}
            step={selectedStep}
            node={selectedNode}
            focusedItemId={focusedItemId}
            contextItems={contextItems}
            itemEffect={selectedEffect}
            inputSources={inputSources}
            onFocusItem={focusResult}
            onOpenArtifact={openArtifact}
          />
        </div>
      </div>
      <ArtifactDrawer
        key={`${artifactItem?.id ?? "closed"}:${artifactMode}`}
        item={artifactItem}
        contextItems={contextItems}
        query={query}
        initialMode={artifactMode}
        onClose={() => setArtifactItem(null)}
      />
    </div>
  );
}
