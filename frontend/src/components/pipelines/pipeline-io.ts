import type { PipelineNodeData } from "./PipelineNode";
import type { Connection, Node } from "@xyflow/react";

type PortCompatibilityMap = Record<string, Set<string>>;

const PORT_COMPATIBILITY: PortCompatibilityMap = {
  document_source: new Set(["document_source"]),
  document: new Set(["document"]),
  chunk_batch: new Set(["chunk_batch"]),
  embedded_batch: new Set(["embedded_batch"]),
  indexed_batch: new Set(["indexed_batch"]),
  query_request: new Set(["query_request"]),
  retrieval_results: new Set(["retrieval_results"]),
};

const resolvePortType = (
  node: Node<PipelineNodeData> | undefined,
  handleId: string | null | undefined,
  kind: "input" | "output",
) => {
  if (!node || !handleId) return undefined;
  const ports = kind === "input" ? node.data.inputs : node.data.outputs;
  return ports.find((port) => port.key === handleId)?.data_type;
};

export const validatePipelineConnection = (
  connection: Connection,
  nodes: Node<PipelineNodeData>[],
) => {
  if (!connection.source || !connection.target) {
    return { valid: false, reason: "Connections must have both a source and a target." };
  }
  if (connection.source === connection.target) {
    return { valid: false, reason: "Nodes cannot connect to themselves." };
  }
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  const sourceType = resolvePortType(sourceNode, connection.sourceHandle, "output");
  const targetType = resolvePortType(targetNode, connection.targetHandle, "input");

  if (!sourceType || !targetType) {
    return { valid: false, reason: "Connections must specify compatible ports." };
  }

  const allowed = PORT_COMPATIBILITY[sourceType] ?? new Set([sourceType]);
  if (!allowed.has(targetType)) {
    return {
      valid: false,
      reason: `Cannot connect ${sourceType} to ${targetType}.`,
    };
  }

  return { valid: true };
};
