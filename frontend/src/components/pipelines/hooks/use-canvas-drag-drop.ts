"use client";

import { useCallback, useState, type DragEvent } from "react";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type FlowPosition = { x: number; y: number };

const PREVIEW_NODE_SIZE = { width: 180, height: 72 };
const NODE_TYPE_MIME = "application/ragworks-node";

type LegacyReactFlowInstance = {
  project: (point: FlowPosition) => FlowPosition;
};

// @xyflow/react v12 instances always expose screenToFlowPosition, but some callers
// (and tests) still provide the pre-v12 `.project` API; support both. A `typeof`
// check is used instead of `"x" in instance` narrowing because the v12 type makes
// screenToFlowPosition non-optional, which would make the fallback branch
// statically unreachable (and thus untypeable) under `in`-based narrowing.
const resolveFlowPosition = (
  instance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType>,
  point: FlowPosition,
) =>
  typeof instance.screenToFlowPosition === "function"
    ? instance.screenToFlowPosition(point)
    : (instance as unknown as LegacyReactFlowInstance).project(point);

const pointFromEvent = (event: DragEvent<HTMLDivElement>): FlowPosition => ({
  x: event.clientX - PREVIEW_NODE_SIZE.width / 2,
  y: event.clientY - PREVIEW_NODE_SIZE.height / 2,
});

interface UseCanvasDragDropParams {
  catalogSpecs: NodeSpec[];
  reactFlowInstance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType> | null;
  onAddNode: (spec: NodeSpec, position?: FlowPosition) => void;
  onUnknownNodeType: () => void;
}

export interface UseCanvasDragDropResult {
  dropPreviewPosition: FlowPosition | null;
  dropPreviewLabel: string | null;
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: () => void;
}

/**
 * Owns the drop-preview ghost node shown while dragging a node-catalog entry over the
 * canvas, plus the drag-over/drop/drag-leave handlers. The previous implementation had
 * the screenToFlowPosition/`.project` fallback duplicated between the dragover and drop
 * handlers; `resolveFlowPosition` above is now the single implementation both share.
 */
export function useCanvasDragDrop({
  catalogSpecs,
  reactFlowInstance,
  onAddNode,
  onUnknownNodeType,
}: UseCanvasDragDropParams): UseCanvasDragDropResult {
  const [dropPreviewPosition, setDropPreviewPosition] = useState<FlowPosition | null>(null);
  const [dropPreviewLabel, setDropPreviewLabel] = useState<string | null>(null);

  const handleDragLeave = useCallback(() => {
    setDropPreviewPosition(null);
    setDropPreviewLabel(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const type = event.dataTransfer.getData(NODE_TYPE_MIME);
      if (!type) {
        handleDragLeave();
        return;
      }
      const spec = catalogSpecs.find((item) => item.type === type);
      if (!spec || !reactFlowInstance) {
        handleDragLeave();
        return;
      }
      const position = resolveFlowPosition(reactFlowInstance, pointFromEvent(event));
      setDropPreviewPosition(position);
      setDropPreviewLabel(spec.label);
    },
    [catalogSpecs, handleDragLeave, reactFlowInstance],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(NODE_TYPE_MIME);
      if (!type) return;
      const spec = catalogSpecs.find((item) => item.type === type);
      if (!spec) {
        onUnknownNodeType();
        return;
      }
      if (dropPreviewPosition) {
        onAddNode(spec, dropPreviewPosition);
        return;
      }
      if (!reactFlowInstance) {
        onAddNode(spec);
        return;
      }
      const position = resolveFlowPosition(reactFlowInstance, pointFromEvent(event));
      onAddNode(spec, position);
    },
    [catalogSpecs, dropPreviewPosition, onAddNode, onUnknownNodeType, reactFlowInstance],
  );

  return { dropPreviewPosition, dropPreviewLabel, handleDragOver, handleDrop, handleDragLeave };
}
