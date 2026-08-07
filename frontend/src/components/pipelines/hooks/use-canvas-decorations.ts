"use client";

import { useMemo } from "react";

import { validatePipelineConfig, validatePipelineEdges } from "../lib/pipeline-io";
import { DROP_PREVIEW_HEIGHT, ESTIMATED_NODE_WIDTH } from "../lib/pipeline-layout";
import { getNodeFamilyLabel, resolveNodeFamily } from "../lib/pipeline-theme";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { ConnectingContext, PipelineNodeData } from "../PipelineNode";
import type { PipelineValidationIssue } from "@/lib/types";
import type { Node } from "@xyflow/react";

type UseCanvasDecorationsArgs = {
  nodes: Node<PipelineNodeData>[];
  edges: TypedEdgeType[];
  connecting: ConnectingContext | null;
  validationIssues: PipelineValidationIssue[];
  dropPreviewPosition: { x: number; y: number } | null;
  dropPreviewLabel: string | null;
};

/**
 * Client-side validation plus canvas decoration: merges local edge/config
 * errors with server validation issues onto each node, flags erroring edges,
 * and appends the drag-and-drop preview node.
 */
export function useCanvasDecorations({
  nodes,
  edges,
  connecting,
  validationIssues,
  dropPreviewPosition,
  dropPreviewLabel,
}: UseCanvasDecorationsArgs) {
  const { edgeErrors, nodeErrors } = useMemo(() => {
    const edgeValidation = validatePipelineEdges(nodes, edges);
    const configValidation = validatePipelineConfig(nodes);
    const mergedNodeErrors: Record<string, string[]> = { ...edgeValidation.nodeErrors };
    Object.entries(configValidation.nodeErrors).forEach(([nodeId, errors]) => {
      mergedNodeErrors[nodeId] = [...(mergedNodeErrors[nodeId] ?? []), ...errors];
    });
    return { edgeErrors: edgeValidation.edgeErrors, nodeErrors: mergedNodeErrors };
  }, [nodes, edges]);

  const serverNodeErrors = useMemo(() => {
    const byNode: Record<string, string[]> = {};
    validationIssues.forEach((issue) => {
      if (!issue.node_id || issue.severity !== "error") return;
      byNode[issue.node_id] = [...(byNode[issue.node_id] ?? []), issue.message];
    });
    return byNode;
  }, [validationIssues]);

  const nodesForCanvas = useMemo(() => {
    const decorated = nodes.map((node) => {
      const errors = [...(nodeErrors[node.id] ?? []), ...(serverNodeErrors[node.id] ?? [])];
      return {
        ...node,
        // xyflow gives each node wrapper `role="group"` with no name of its
        // own, so a screen reader reaches a canvas of unnamed groups. The
        // error count rides along because the red border carrying it is not
        // available to one.
        ariaLabel: `${node.data.label} — ${getNodeFamilyLabel(resolveNodeFamily(node.data.nodeType))} node${
          errors.length > 0 ? `, ${errors.length} problem${errors.length === 1 ? "" : "s"}` : ""
        }`,
        data: { ...node.data, connecting, errors },
      };
    });
    if (!dropPreviewPosition) return decorated;
    const dropPreviewNode = {
      id: "drop-preview",
      type: "dropPreview",
      position: dropPreviewPosition,
      // Edge routing receives every canvas node before React Flow has measured
      // the preview. Pin its rendered geometry so the router never falls back
      // to the PipelineNodeData estimator for this intentionally lighter shape.
      width: ESTIMATED_NODE_WIDTH,
      height: DROP_PREVIEW_HEIGHT,
      data: { label: dropPreviewLabel ?? "Drop here" },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    } satisfies Node;
    // The drop-preview node carries DropPreviewNodeData, not PipelineNodeData; xyflow
    // dispatches rendering by `type`, so the heterogeneous array is safe at runtime even
    // though it can't be expressed without a discriminated Node union across this module.
    return [...decorated, dropPreviewNode as unknown as Node<PipelineNodeData>];
  }, [nodes, connecting, nodeErrors, serverNodeErrors, dropPreviewLabel, dropPreviewPosition]);

  const edgesWithValidation = useMemo(
    () =>
      edges.map((edge) => {
        const error = edgeErrors[edge.id];
        if (!error) return edge;
        return { ...edge, data: { ...edge.data, error: true } };
      }),
    [edges, edgeErrors],
  );

  return { nodeErrors, nodesForCanvas, edgesWithValidation };
}
