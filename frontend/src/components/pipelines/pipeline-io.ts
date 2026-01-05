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

const resolveNodeConfig = (
  node: Node<PipelineNodeData> | undefined,
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  if (!node) return {};
  return configOverrides?.[node.id] ?? node.data.config ?? {};
};

const resolveDimension = (config: Record<string, unknown>) => {
  const value = config.dimension;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const validateDimensionConnection = (
  sourceNode: Node<PipelineNodeData> | undefined,
  targetNode: Node<PipelineNodeData> | undefined,
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  if (!sourceNode || !targetNode) return null;
  if (sourceNode.data.nodeType !== "embedder.openrouter") return null;
  if (targetNode.data.nodeType !== "indexer.pinecone") return null;
  const sourceConfig = resolveNodeConfig(sourceNode, configOverrides);
  const targetConfig = resolveNodeConfig(targetNode, configOverrides);
  const sourceDim = resolveDimension(sourceConfig);
  const targetDim = resolveDimension(targetConfig);
  if (sourceDim && targetDim && sourceDim !== targetDim) {
    return `Embedding dimension ${sourceDim} does not match index dimension ${targetDim}.`;
  }
  return null;
};

export const validatePipelineConnection = (
  connection: Connection,
  nodes: Node<PipelineNodeData>[],
  configOverrides?: Record<string, Record<string, unknown>>,
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

  const dimensionError = validateDimensionConnection(sourceNode, targetNode, configOverrides);
  if (dimensionError) {
    return { valid: false, reason: dimensionError };
  }

  return { valid: true };
};

export const validatePipelineEdges = (
  nodes: Node<PipelineNodeData>[],
  edges: Array<{ id: string; source: string; target: string }>,
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeErrors: Record<string, string> = {};
  const nodeErrors: Record<string, string[]> = {};

  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    const dimensionError = validateDimensionConnection(sourceNode, targetNode, configOverrides);
    if (!dimensionError) return;
    edgeErrors[edge.id] = dimensionError;
    if (targetNode) {
      nodeErrors[targetNode.id] = [...(nodeErrors[targetNode.id] ?? []), dimensionError];
    }
  });

  return { edgeErrors, nodeErrors };
};
