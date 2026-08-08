"use client";

import {
  Background,
  ConnectionLineType,
  Controls,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type OnConnectEnd,
  type OnConnectStart,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Wand2 } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { InstrumentLabel } from "@/components/ui/instrument-label";
import { Notification } from "@/components/ui/notification";
import { Tooltip } from "@/components/ui/tooltip";

import { ConnectionFeedback } from "./ConnectionFeedback";
import { PipelineNodeActionsProvider } from "./flow/node-actions-context";
import { PipelineEdgeRoutingProvider } from "./flow/PipelineEdgeRoutingProvider";
import { pipelineEdgeTypes } from "./flow/TypedEdge";
import { useFlowDotColor } from "./flow/use-flow-dot-color";
import { portToken } from "./lib/facet-inference";
import { getPortTypeColorVar, getPortTypeLabel } from "./lib/pipeline-theme";
import { pipelineNodeTypes } from "./PipelineNode";

import type { ConnectionFeedbackNotice } from "./ConnectionFeedback";
import type { TypedEdgeType } from "./flow/TypedEdge";
import type { PipelineNodeData } from "./PipelineNode";
import type { Pipeline } from "@/lib/types";
import type { DragEvent, KeyboardEvent } from "react";

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
  onConnectEnd?: OnConnectEnd;
  /** What just happened to a connection, shown at the drop point. */
  connectionNotice?: ConnectionFeedbackNotice | null;
  onConnectionNoticeDismiss?: () => void;
  isValidConnection?: (connection: Edge | Connection) => boolean;
  /** A single click: selection only, so the toolbar appears and nothing opens. */
  onNodeSelect: (nodeId: string) => void;
  /** Opens the inspector — double-click, the toolbar's Edit, or Enter. */
  onNodeOpen: (nodeId: string) => void;
  onNodeDelete: (nodeId: string) => void;
  /** Nodes React Flow removed itself, on Delete/Backspace. */
  onNodesDelete: (nodes: Node<PipelineNodeData>[]) => void;
  onNodeDragStop?: () => void;
  onAutoLayout?: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onInit: (instance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType>) => void;
};

/** A key name rendered as the key itself, beside what it does. */
const keyCapClass =
  "rounded-chip border border-hairline bg-surface px-1 font-mono text-instrument leading-4 text-meta";

/** Stable stand-in for an absent dismiss handler, so the notice's own
 *  countdown is never restarted by a fresh callback identity. */
const noop = () => {};

/** Where the canvas's own Enter and Tab keys mean something else already. */
const INERT_TARGETS =
  "input, textarea, select, button, a, [contenteditable='true'], [role='dialog']";

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
  connectionNotice,
  onConnectionNoticeDismiss,
  isValidConnection,
  onNodeSelect,
  onNodeOpen,
  onNodeDelete,
  onNodesDelete,
  onNodeDragStop,
  onAutoLayout,
  onDrop,
  onDragOver,
  onDragLeave,
  onInit,
}: PipelineCanvasProps) {
  const dataTypes = legendTypes(nodes);
  const dotColor = useFlowDotColor();
  const nodeActions = useMemo(
    () => ({
      editNode: onNodeOpen,
      deleteNode: onNodeDelete,
      deselectNode: (nodeId: string) =>
        onNodesChange([{ id: nodeId, type: "select", selected: false }]),
    }),
    [onNodeOpen, onNodeDelete, onNodesChange],
  );

  // Enter opens the node the keystroke belongs to: the focused card, or the
  // selected one when focus sits elsewhere on the canvas. Scoped to the canvas
  // subtree, so Enter keeps its ordinary meaning everywhere else on the page.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(INERT_TARGETS)) return;
    const card = target?.closest<HTMLElement>(".react-flow__node");
    // Tab from a card steps into its own floating toolbar. The toolbar is
    // portaled to the end of the canvas, so document order would otherwise
    // put its actions past every other node on the graph.
    if (event.key === "Tab" && !event.shiftKey && card?.dataset.id) {
      const action = document.querySelector<HTMLElement>(
        `.react-flow__node-toolbar[data-id="${card.dataset.id}"] [role="toolbar"] button`,
      );
      if (!action) return;
      event.preventDefault();
      action.focus();
      return;
    }
    if (event.key !== "Enter") return;
    const focused = card?.dataset.id;
    const openable = nodes.find(
      (node) => node.id === (focused ?? nodes.find((item) => item.selected)?.id),
    );
    if (!openable || openable.type !== "pipelineNode") return;
    event.preventDefault();
    onNodeOpen(openable.id);
  };

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
        <div className="card-surface absolute bottom-14 right-3 z-10 flex max-w-[70%] flex-col items-end gap-1 bg-canvas-raised px-2 py-1 shadow-elevation-2 xl:bottom-3">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
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
          {/* The port marks, spelled out: a glyph nothing explains is a glyph
              the user has to hover every port to decode. */}
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t border-hairline pt-1">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="font-mono text-instrument text-meta">
                ∗
              </span>
              <InstrumentLabel>Required input</InstrumentLabel>
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="font-mono text-instrument text-meta">
                +
              </span>
              <InstrumentLabel>Accepts many connections</InstrumentLabel>
            </span>
          </div>
          {/* What a selected node can do, written down: the edit and delete
              actions live in a toolbar that appears on selection, and their
              keys are otherwise only in hover tooltips a touch device never
              shows. */}
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t border-hairline pt-1">
            <span className="flex items-center gap-1.5">
              <kbd className={keyCapClass}>Enter</kbd>
              <InstrumentLabel>Edit selected node</InstrumentLabel>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className={keyCapClass}>Del</kbd>
              <InstrumentLabel>Delete selected node</InstrumentLabel>
            </span>
          </div>
        </div>
      ) : null}
      <ConnectionFeedback
        notice={connectionNotice ?? null}
        onDismiss={onConnectionNoticeDismiss ?? noop}
      />
      <div
        className="h-full"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onKeyDown={handleKeyDown}
      >
        <PipelineEdgeRoutingProvider nodes={nodes}>
          <PipelineNodeActionsProvider value={nodeActions}>
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
              onNodeDoubleClick={(_, node) => onNodeOpen(node.id)}
              onNodesDelete={onNodesDelete}
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
              // React Flow's default binds Backspace alone; Delete is the key
              // users reach for, and without it the only way to remove a node
              // reads as no way at all.
              deleteKeyCode={["Delete", "Backspace"]}
              proOptions={{ hideAttribution: true }}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
              minZoom={0.2}
            >
              <Background gap={18} size={1} color={dotColor} />
              <Controls className="pipeline-controls" />
            </ReactFlow>
          </PipelineNodeActionsProvider>
        </PipelineEdgeRoutingProvider>
      </div>
    </div>
  );
}
