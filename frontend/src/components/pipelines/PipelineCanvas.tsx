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
import { ClipboardCheck, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";

import { pipelineEdgeTypes } from "./flow/TypedEdge";
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

/** Data types actually present on the canvas, for the legend. */
const legendTypes = (nodes: Node<PipelineNodeData>[]): string[] => {
  const seen = new Set<string>();
  nodes.forEach((node) => {
    (node.data.inputs ?? []).forEach((port) => seen.add(port.data_type));
    (node.data.outputs ?? []).forEach((port) => seen.add(port.data_type));
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
  return (
    <div className="h-full">
      <GlassCard className="relative min-h-[520px] overflow-hidden rounded-3xl border border-white/5 bg-slate-950/80 xl:h-full xl:min-h-0">
        {notice ? (
          <div className="absolute left-1/2 top-4 z-20 w-[min(520px,90%)] -translate-x-1/2">
            <Notification key={notice} message={notice} onDismiss={onNoticeDismiss} />
          </div>
        ) : null}
        <div className="absolute left-4 top-4 z-10 flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
          <ClipboardCheck className="h-4 w-4 text-cyan-300" />
          {selectedPipeline ? (
            <span>
              {selectedPipeline.name} · v{selectedPipeline.current_version}
            </span>
          ) : (
            <span>Select a pipeline to edit.</span>
          )}
        </div>
        {onAutoLayout ? (
          <div className="absolute right-4 top-4 z-10">
            <Button
              size="sm"
              variant="secondary"
              onClick={onAutoLayout}
              className="flex items-center gap-2"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Tidy layout
            </Button>
          </div>
        ) : null}
        {dataTypes.length > 0 ? (
          <div className="absolute bottom-4 right-4 z-10 flex max-w-[70%] flex-wrap items-center justify-end gap-x-3 gap-y-1 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2">
            {dataTypes.map((dataType) => (
              <span key={dataType} className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: getPortTypeColorVar(dataType) }}
                />
                {getPortTypeLabel(dataType)}
              </span>
            ))}
          </div>
        ) : null}
        <div
          className="h-full min-h-[520px] xl:min-h-0"
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
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
            connectionLineStyle={{ stroke: "#94a3b8", strokeWidth: 2, strokeDasharray: "6 4" }}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.2}
          >
            <Background gap={18} size={1} color="#1f2937" />
            <Controls className="pipeline-controls" />
          </ReactFlow>
        </div>
      </GlassCard>
    </div>
  );
}
