"use client";

import { useCallback, useState, type DragEvent } from "react";

import { DROP_PREVIEW_HEIGHT, ESTIMATED_NODE_WIDTH } from "../lib/pipeline-layout";
import { NODE_PRESET_MIME, resolveDraggedSpec } from "../lib/presets";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec } from "@/lib/types";
import type { Node, ReactFlowInstance } from "@xyflow/react";

type FlowPosition = { x: number; y: number };

/** The dropped card's own size, so it centres on the pointer rather than
 *  landing offset by however much a guess differed from the real card. */
const PREVIEW_NODE_SIZE = { width: ESTIMATED_NODE_WIDTH, height: DROP_PREVIEW_HEIGHT };
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

/**
 * Where a card dropped under the pointer belongs, in flow coordinates.
 *
 * The half-card offset is subtracted after the conversion, never before: node
 * sizes are flow units and the pointer is screen pixels, so offsetting first
 * scales the correction by the zoom and the card lands further off the cursor
 * the further out the canvas is zoomed.
 */
const dropPositionFromEvent = (
  instance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType>,
  event: DragEvent<HTMLDivElement>,
): FlowPosition => {
  const point = resolveFlowPosition(instance, { x: event.clientX, y: event.clientY });
  return {
    x: point.x - PREVIEW_NODE_SIZE.width / 2,
    y: point.y - PREVIEW_NODE_SIZE.height / 2,
  };
};

interface UseCanvasDragDropParams {
  catalogSpecs: NodeSpec[];
  reactFlowInstance: ReactFlowInstance<Node<PipelineNodeData>, TypedEdgeType> | null;
  onAddNode: (spec: NodeSpec, position?: FlowPosition) => void;
  onUnknownNodeType: () => void;
  canAddNode?: (spec: NodeSpec) => boolean;
  onUnavailableNodeType?: () => void;
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
  canAddNode = () => true,
  onUnavailableNodeType,
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
      const baseSpec = catalogSpecs.find((item) => item.type === type);
      if (!baseSpec || !canAddNode(baseSpec) || !reactFlowInstance) {
        handleDragLeave();
        return;
      }
      const presetId = event.dataTransfer.getData(NODE_PRESET_MIME);
      const spec = presetId ? resolveDraggedSpec(baseSpec, presetId) : baseSpec;
      setDropPreviewPosition(dropPositionFromEvent(reactFlowInstance, event));
      setDropPreviewLabel(spec.label);
    },
    [canAddNode, catalogSpecs, handleDragLeave, reactFlowInstance],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(NODE_TYPE_MIME);
      if (!type) return;
      const baseSpec = catalogSpecs.find((item) => item.type === type);
      if (!baseSpec) {
        onUnknownNodeType();
        return;
      }
      const presetId = event.dataTransfer.getData(NODE_PRESET_MIME);
      const spec = presetId ? resolveDraggedSpec(baseSpec, presetId) : baseSpec;
      if (!canAddNode(spec)) {
        handleDragLeave();
        onUnavailableNodeType?.();
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
      onAddNode(spec, dropPositionFromEvent(reactFlowInstance, event));
    },
    [
      canAddNode,
      catalogSpecs,
      dropPreviewPosition,
      handleDragLeave,
      onAddNode,
      onUnavailableNodeType,
      onUnknownNodeType,
      reactFlowInstance,
    ],
  );

  return { dropPreviewPosition, dropPreviewLabel, handleDragOver, handleDrop, handleDragLeave };
}
