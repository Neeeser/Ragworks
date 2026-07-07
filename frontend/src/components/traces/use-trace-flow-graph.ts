import { useMemo } from "react";

import { toFlowEdges } from "@/components/pipelines/lib/pipeline-utils";
import {
  buildCursorNode,
  getNodeAnchor,
  getNodeCenter,
} from "@/components/traces/trace-payload-utils";

import type { PipelineNodeIOTrace, PipelineNodeRunTrace, PipelineTraceResponse } from "@/lib/types";
import type { Edge, Node } from "@xyflow/react";

type IOGroup = {
  inputs: PipelineNodeIOTrace[];
  outputs: PipelineNodeIOTrace[];
};

type UseTraceFlowGraphParams = {
  trace: PipelineTraceResponse | null;
  positionedNodes: Node[];
  orderedRuns: PipelineNodeRunTrace[];
  activeIndex: number;
  activeNodeId: string | undefined;
};

type UseTraceFlowGraphResult = {
  nodes: Node[];
  edges: Edge[];
  ioByNode: Map<string, IOGroup>;
};

/**
 * Builds the ReactFlow nodes/edges for the active trace step: marks the active node,
 * highlights the edge it's traveling along, positions the animated cursor between
 * nodes, and groups the raw IO records by node id for the detail panels below.
 */
export function useTraceFlowGraph({
  trace,
  positionedNodes,
  orderedRuns,
  activeIndex,
  activeNodeId,
}: UseTraceFlowGraphParams): UseTraceFlowGraphResult {
  const baseNodes = useMemo(
    () =>
      positionedNodes.map((node) => ({
        ...node,
        data: { ...node.data, active: node.id === activeNodeId },
      })),
    [positionedNodes, activeNodeId],
  );

  const activeEdge = useMemo(() => {
    if (!trace || !activeNodeId) return null;
    const nextNodeId = orderedRuns[activeIndex + 1]?.node_id;
    if (nextNodeId) {
      return (
        trace.definition.edges.find(
          (edge) => edge.source === activeNodeId && edge.target === nextNodeId,
        ) ?? null
      );
    }
    const previousNodeId = orderedRuns[activeIndex - 1]?.node_id;
    if (previousNodeId) {
      return (
        trace.definition.edges.find(
          (edge) => edge.source === previousNodeId && edge.target === activeNodeId,
        ) ?? null
      );
    }
    return null;
  }, [trace, activeNodeId, orderedRuns, activeIndex]);

  const activeEdgeIds = useMemo(() => {
    if (!activeEdge) return new Set<string>();
    return new Set([activeEdge.id]);
  }, [activeEdge]);

  const edges = useMemo(() => {
    if (!trace) return [];
    return toFlowEdges(trace.definition).map((edge) => ({
      ...edge,
      animated: activeEdgeIds.has(edge.id),
      style: {
        stroke: activeEdgeIds.has(edge.id) ? "#38bdf8" : "#334155",
        strokeWidth: activeEdgeIds.has(edge.id) ? 2.5 : 1.25,
      },
    }));
  }, [trace, activeEdgeIds]);

  const cursorPosition = useMemo(() => {
    if (!activeNodeId) return null;
    if (activeEdge) {
      const sourceNode = baseNodes.find((entry) => entry.id === activeEdge.source);
      const targetNode = baseNodes.find((entry) => entry.id === activeEdge.target);
      if (sourceNode && targetNode) {
        const sourceAnchor = getNodeAnchor(sourceNode, "source");
        const targetAnchor = getNodeAnchor(targetNode, "target");
        return {
          x: (sourceAnchor.x + targetAnchor.x) / 2,
          y: (sourceAnchor.y + targetAnchor.y) / 2,
        };
      }
    }
    const fallbackNode = baseNodes.find((entry) => entry.id === activeNodeId);
    return fallbackNode ? getNodeCenter(fallbackNode) : null;
  }, [activeNodeId, activeEdge, baseNodes]);

  const cursorNode = useMemo(() => buildCursorNode(cursorPosition ?? undefined), [cursorPosition]);

  const nodes = useMemo(() => {
    if (!cursorNode) return baseNodes;
    return [...baseNodes, cursorNode];
  }, [baseNodes, cursorNode]);

  const ioByNode = useMemo(() => {
    const grouped = new Map<string, IOGroup>();
    if (!trace) return grouped;
    trace.node_io.forEach((record) => {
      const entry = grouped.get(record.node_id) ?? { inputs: [], outputs: [] };
      if (record.io_type === "input") {
        entry.inputs.push(record);
      } else {
        entry.outputs.push(record);
      }
      grouped.set(record.node_id, entry);
    });
    return grouped;
  }, [trace]);

  return { nodes, edges, ioByNode };
}
