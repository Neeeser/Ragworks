"use client";

import { Background, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { pipelineNodeTypes } from "../PipelineNode";

import { PipelineEdgeRoutingProvider } from "./PipelineEdgeRoutingProvider";
import { pipelineEdgeTypes } from "./TypedEdge";
import { useFlowDotColor } from "./use-flow-dot-color";
import { useFlowPlayback } from "./use-flow-playback";
import { ViewportVerticalAnchor } from "./ViewportVerticalAnchor";

import type { FlowStep } from "../lib/pipeline-playback";
import type { PipelineNodeData } from "../PipelineNode";
import type { TypedEdgeType } from "./TypedEdge";
import type { UseFlowPlaybackResult } from "./use-flow-playback";
import type { Node, NodeTypes } from "@xyflow/react";

type FlowPlayerProps = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  /** Node visits in execution order; empty renders a static (non-playing) graph. */
  steps: FlowStep[];
  autoPlay?: boolean;
  processMs?: number;
  travelMs?: number;
  fitViewPadding: number;
  onActiveStepChange?: (index: number) => void;
  className?: string;
  /** Compact hides the step scrubber (landing-page style ambient playback). */
  compact?: boolean;
  /**
   * Ambient mode: an always-looping, non-interactive backdrop. Hides all
   * controls, disables clicks/pans, and restarts playback at the end. Used
   * for the landing-page hero flow.
   */
  ambient?: boolean;
  /**
   * Whether playback restarts after the last step. Defaults to `ambient`
   * (an ambient backdrop loops forever); pass `false` with `onRunComplete`
   * to let a surrounding surface rotate scenes between runs instead.
   */
  loop?: boolean;
  /** Fired once when a non-looping run finishes (see useFlowPlayback). */
  onRunComplete?: () => void;
  /**
   * Pin this node's row to the container's vertical center instead of
   * fitView's bounding-box center — keeps a designated node at the same
   * screen height when graphs of different row counts rotate through one
   * surface (the landing hero).
   */
  anchorNodeId?: string;
  /**
   * Lower bound for fitView's zoom (default 0.2). Ambient full-bleed surfaces
   * (the landing hero) pass a smaller floor so wide graphs still fit entirely
   * inside narrow (mobile) viewports instead of rendering clipped.
   */
  minZoom?: number;
  /** Extra node types merged over the pipeline defaults (e.g. the trace index store). */
  nodeTypes?: NodeTypes;
  /**
   * Externally owned playback state. When provided, the player renders and
   * controls this instead of creating its own — so a surrounding surface (the
   * trace debugger's step rail, keyboard shortcuts) can share one stepper.
   */
  playback?: UseFlowPlaybackResult;
};

/** Internal playback never auto-plays when an external one is in charge. */
const resolveInternalAutoPlay = (
  externalPlayback: UseFlowPlaybackResult | undefined,
  autoPlay: boolean,
): boolean => (externalPlayback ? false : autoPlay);

/**
 * Read-only pipeline graph with synchronized playback: the active node glows
 * while it "processes", then a payload dot rides the actual edge path to the
 * next node. The camera fits the whole graph once and stays put -- pipelines
 * are small enough that panning per step is disorienting, not helpful.
 */
export function FlowPlayer({
  nodes,
  edges,
  steps,
  autoPlay = false,
  processMs,
  travelMs,
  fitViewPadding,
  onActiveStepChange,
  className,
  compact = false,
  ambient = false,
  loop,
  onRunComplete,
  anchorNodeId,
  minZoom = 0.2,
  nodeTypes,
  playback: externalPlayback,
}: FlowPlayerProps) {
  // Always created so hook order is stable; inert (autoPlay off, no timers
  // running) whenever an external playback is in charge.
  const internalAutoPlay = resolveInternalAutoPlay(externalPlayback, autoPlay);
  const internalPlayback = useFlowPlayback({
    steps,
    edges,
    autoPlay: internalAutoPlay,
    processMs,
    travelMs,
    loop: loop ?? ambient,
    onRunComplete,
  });
  const playback = externalPlayback ?? internalPlayback;
  const { activeIndex } = playback;
  const dotColor = useFlowDotColor();

  const mergedNodeTypes = useMemo(
    () => (nodeTypes ? { ...pipelineNodeTypes, ...nodeTypes } : pipelineNodeTypes),
    [nodeTypes],
  );

  useEffect(() => {
    onActiveStepChange?.(activeIndex);
  }, [activeIndex, onActiveStepChange]);

  const activeNodeIds = useMemo(
    () => new Set(steps[activeIndex]?.nodeIds ?? []),
    [steps, activeIndex],
  );

  const stepIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>();
    steps.forEach((step, index) => {
      for (const nodeId of step.nodeIds) {
        if (!map.has(nodeId)) map.set(nodeId, index);
      }
    });
    return map;
  }, [steps]);

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        draggable: false,
        connectable: false,
        // Nodes that map to a step are clickable to jump there; others (e.g.
        // the shared-index datastore) keep the default cursor.
        className: stepIndexByNodeId.has(node.id) ? "cursor-pointer" : undefined,
        data: { ...node.data, active: steps.length > 0 && activeNodeIds.has(node.id) },
      })),
    [nodes, activeNodeIds, steps.length, stepIndexByNodeId],
  );

  const decoratedEdges = useMemo(
    () =>
      edges.map((edge) => {
        // The dot's <g> unmounts whenever `traveling` flips off, so each travel
        // phase remounts it and animateMotion restarts from the edge's start.
        const traveling = playback.travelingEdgeIds.has(edge.id);
        return {
          ...edge,
          data: {
            ...edge.data,
            active: traveling,
            traveling,
            travelMs: playback.travelMs,
            visited: playback.visitedEdgeIds.has(edge.id),
          },
        };
      }),
    [edges, playback.travelingEdgeIds, playback.visitedEdgeIds, playback.travelMs],
  );

  return (
    <div
      className={cn("relative h-full w-full", ambient && "pointer-events-none", className)}
      aria-hidden={ambient || undefined}
    >
      <PipelineEdgeRoutingProvider nodes={decoratedNodes}>
        <ReactFlow
          nodes={decoratedNodes}
          edges={decoratedEdges}
          nodeTypes={mergedNodeTypes}
          edgeTypes={pipelineEdgeTypes}
          onNodeClick={
            ambient
              ? undefined
              : (_event, node) => {
                  const index = stepIndexByNodeId.get(node.id);
                  if (index !== undefined) playback.seek(index);
                }
          }
          fitView
          fitViewOptions={{ padding: fitViewPadding, maxZoom: 1 }}
          minZoom={minZoom}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnDrag={!compact && !ambient}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color={dotColor} />
          {anchorNodeId ? <ViewportVerticalAnchor nodeId={anchorNodeId} /> : null}
        </ReactFlow>
      </PipelineEdgeRoutingProvider>

      {steps.length > 0 && !ambient ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-canvas-raised/90 px-2 py-1.5 shadow-elevation-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={playback.stepBack}
              disabled={activeIndex === 0}
              aria-label="Previous step"
              className="flex h-7 w-7 items-center justify-center p-0"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={playback.toggle}
              aria-label={playback.playing ? "Pause playback" : "Play pipeline"}
              className="flex h-7 w-7 items-center justify-center p-0"
            >
              {playback.playing ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={playback.stepForward}
              disabled={activeIndex >= steps.length - 1}
              aria-label="Next step"
              className="flex h-7 w-7 items-center justify-center p-0"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={playback.restart}
              aria-label="Restart playback"
              className="flex h-7 w-7 items-center justify-center p-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            {!compact ? (
              <div
                className="ml-1 flex items-center gap-1 pr-1"
                role="tablist"
                aria-label="Pipeline steps"
              >
                {steps.map((step, index) => {
                  const node = nodes.find((entry) => entry.id === step.nodeIds[0]);
                  const label =
                    step.nodeIds.length > 1
                      ? step.nodeIds.join(" + ")
                      : (node?.data.label ?? step.nodeIds[0]);
                  return (
                    <button
                      key={`${step.nodeIds.join("+")}-${index}`}
                      type="button"
                      role="tab"
                      aria-selected={index === activeIndex}
                      aria-label={label}
                      title={label}
                      onClick={() => playback.seek(index)}
                      className={cn(
                        "h-2 rounded-full transition-all",
                        index === activeIndex
                          ? "w-5 bg-accent-cyan"
                          : index < activeIndex
                            ? "w-2 bg-accent-cyan/50 hover:bg-accent-cyan/70"
                            : "w-2 bg-strong hover:brightness-150",
                      )}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
