"use client";

import { Background, Controls, ReactFlow } from "@xyflow/react";
import { Braces, ClipboardCheck } from "lucide-react";

import { Notification } from "@/components/ui/notification";
import { GlassCard } from "@/components/ui/panel";

import { pipelineNodeTypes } from "./PipelineNode";

import type { PipelineNodeData } from "./PipelineNode";
import type { Pipeline } from "@/lib/types";
import type { Connection, Edge, Node, OnEdgesChange, OnNodesChange } from "@xyflow/react";

type PipelineCanvasProps = {
  nodes: Node<PipelineNodeData>[];
  edges: Edge[];
  selectedPipeline: Pipeline | null;
  notice?: string | null;
  onNoticeDismiss?: () => void;
  onNodesChange: OnNodesChange<PipelineNodeData>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  onNodeSelect: (nodeId: string) => void;
};

export function PipelineCanvas({
  nodes,
  edges,
  selectedPipeline,
  notice,
  onNoticeDismiss,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeSelect,
}: PipelineCanvasProps) {
  return (
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
            Editing {selectedPipeline.name} • v{selectedPipeline.current_version}
          </span>
        ) : (
          <span>Select a pipeline to edit.</span>
        )}
      </div>
      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
        <Braces className="h-4 w-4 text-violet-300" />
        <span>
          {nodes.length} nodes • {edges.length} edges
        </span>
      </div>
      <div className="h-full min-h-[520px] xl:min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => onNodeSelect(node.id)}
          nodeTypes={pipelineNodeTypes}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background gap={18} size={1} color="#1f2937" />
          <Controls className="pipeline-controls" />
        </ReactFlow>
      </div>
    </GlassCard>
  );
}
