"use client";

import {
  Background,
  ConnectionLineType,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnectStart,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Notification } from "@/components/ui/notification";
import { Tooltip } from "@/components/ui/tooltip";

import { PipelineEdgeRoutingProvider } from "./flow/PipelineEdgeRoutingProvider";
import { pipelineEdgeTypes } from "./flow/TypedEdge";
import { useFlowDotColor } from "./flow/use-flow-dot-color";
import { portToken } from "./lib/facet-inference";
import { getPortTypeColorVar, getPortTypeLabel } from "./lib/pipeline-theme";
import { pipelineNodeTypes } from "./PipelineNode";

import type { TypedEdgeType } from "./flow/TypedEdge";
import type { PipelineNodeData } from "./PipelineNode";
import type { Pipeline } from "@/lib/types";
import type { DragEvent } from "react";

type PipelineCanvasProps = {
  /** Remounts the flow (and re-fits the camera) when it changes. */
  canvasKey: string;
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  selectedPipeline: Pipeline | null;
  notice?: string | null;
  onNoticeDismiss?: () => void;
  onNodesChange: OnNodesChange<Node<PipelineNodeData>>;
  onEdgesChange: OnEdgesChange<TypedEdgeType>;
  onConnect: (connection: Connection) => void;
  onConnectStart?: OnConnectStart;
  onConnectEnd?: () => void;
  isValidConnection?: (connection: Edge | Connection) => boolean;
  onNodeSelect: (nodeId: string) => void;
  onNodeDragStop?: () => void;
  onAutoLayout?: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onInit: (instance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType>) => void;
};

/** Port tokens actually present on the canvas, for the legend. */
const legendTypes = (nodes: Node<PipelineNodeData>[]): string[] => {
  const seen = new Set<string>();
  nodes.forEach((node) => {
    (node.data.inputs ?? []).forEach((port) => seen.add(portToken(port, "input")));
    (node.data.outputs ?? []).forEach((port) => seen.add(portToken(port, "output")));
  });
  return [...seen];
};

export function PipelineCanvas({
  canvasKey,
  nodes,
  edges,
  selectedPipeline,
  notice,
  onNoticeDismiss,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectStart,
  onConnectEnd,
  isValidConnection,
  onNodeSelect,
  onNodeDragStop,
  onAutoLayout,
  onDrop,
  onDragOver,
  onDragLeave,
  onInit,
}: PipelineCanvasProps) {
  const dataTypes = legendTypes(nodes);
  const dotColor = useFlowDotColor();
  return (
    // The canvas is the card's second pane, full-bleed: no border, no radius,
    // no second surface. The pipeline's identity lives in the top bar.
    <div className="relative min-h-[320px] min-w-0 flex-1">
      {notice ? (
        <div className="absolute left-1/2 top-3 z-20 w-[min(520px,90%)] -translate-x-1/2">
          <Notification key={notice} message={notice} onDismiss={onNoticeDismiss} />
        </div>
      ) : null}
      {!selectedPipeline ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8">
          <p className="text-ui text-muted">Select a pipeline to edit.</p>
        </div>
      ) : null}
      {onAutoLayout ? (
        <div className="absolute right-3 top-3 z-10">
          <Tooltip content="Re-run the automatic layout on every node" side="bottom">
            <Button size="sm" variant="secondary" onClick={onAutoLayout}>
              <Wand2 className="h-3.5 w-3.5" aria-hidden />
              Tidy layout
            </Button>
          </Tooltip>
        </div>
      ) : null}
      {/* Legend sits bottom-14 below xl: the mobile panel pills float at
          bottom-center, and the legend must not sit under them. */}
      {dataTypes.length > 0 ? (
        <div className="card-surface absolute bottom-14 right-3 z-10 flex max-w-[70%] flex-wrap items-center justify-end gap-x-3 gap-y-1 bg-canvas-raised px-2 py-1 shadow-elevation-2 xl:bottom-3">
          {dataTypes.map((dataType) => (
            <span key={dataType} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: getPortTypeColorVar(dataType) }}
              />
              <InstrumentLabel>{getPortTypeLabel(dataType)}</InstrumentLabel>
            </span>
          ))}
        </div>
      ) : null}
      <div className="h-full" onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
        <PipelineEdgeRoutingProvider nodes={nodes}>
          <ReactFlow
            key={canvasKey}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeClick={(_, node) => onNodeSelect(node.id)}
            onNodeDragStop={onNodeDragStop}
            onInit={onInit}
            nodeTypes={pipelineNodeTypes}
            edgeTypes={pipelineEdgeTypes}
            connectionLineType={ConnectionLineType.SmoothStep}
            connectionLineStyle={{
              stroke: "var(--text-muted)",
              strokeWidth: 2,
              strokeDasharray: "6 4",
            }}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background gap={18} size={1} color={dotColor} />
            <Controls className="pipeline-controls" />
          </ReactFlow>
        </PipelineEdgeRoutingProvider>
      </div>
    </div>
  );
}
