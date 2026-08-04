import { expressionSource } from "@/lib/expressions";

import { ITEMS_KIND, facetIssues, inferOutputFacets } from "./facet-inference";

import type { FacetEdge, FacetNodePorts } from "./facet-inference";
import type { PipelineNodeData } from "../PipelineNode";
import type { Connection, Edge, Node } from "@xyflow/react";

const resolvePort = (
  node: Node<PipelineNodeData> | undefined,
  handleId: string | null | undefined,
  kind: "input" | "output",
) => {
  if (!node || !handleId) return undefined;
  const ports = kind === "input" ? node.data.inputs : node.data.outputs;
  return ports.find((port) => port.key === handleId);
};

const toFacetNodePorts = (nodes: Node<PipelineNodeData>[]): FacetNodePorts =>
  new Map(nodes.map((node) => [node.id, { inputs: node.data.inputs, outputs: node.data.outputs }]));

type FacetEdgeSource = Pick<Edge, "id" | "source" | "target"> &
  Partial<Pick<Edge, "sourceHandle" | "targetHandle">>;

const toFacetEdges = (edges: readonly FacetEdgeSource[]): FacetEdge[] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourcePort: edge.sourceHandle,
    target: edge.target,
    targetPort: edge.targetHandle,
  }));

const validateItemFacets = (
  connection: Connection | Edge,
  nodes: Node<PipelineNodeData>[],
  targetRequires: readonly string[],
  edges?: readonly FacetEdgeSource[],
) => {
  const guarantees = inferOutputFacets(toFacetNodePorts(nodes), toFacetEdges(edges ?? [])).get(
    `${connection.source}.${connection.sourceHandle}`,
  );
  // An unresolved source (cycle mid-edit) defers to server validation.
  if (!guarantees) return null;
  const missing = [...targetRequires].filter((facet) => !guarantees.has(facet)).sort();
  if (missing.length === 0) return null;
  return `This connection delivers items without ${missing.join(", ")}.`;
};

const resolveNodeConfig = (
  node: Node<PipelineNodeData> | undefined,
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  /* c8 ignore next -- defensive guard for missing nodes */
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
  if (sourceNode.data.nodeType !== "embedder.text") return null;
  if (!targetNode.data.nodeType.startsWith("indexer.")) return null;
  const sourceConfig = resolveNodeConfig(sourceNode, configOverrides);
  const targetConfig = resolveNodeConfig(targetNode, configOverrides);
  const sourceDim = resolveDimension(sourceConfig);
  const targetDim = resolveDimension(targetConfig);
  if (sourceDim && targetDim && sourceDim !== targetDim) {
    return `Embedding dimension ${sourceDim} does not match index dimension ${targetDim}.`;
  }
  return null;
};

/**
 * Edges already wired into the connection's target port.
 *
 * An occupied single-connection input is *not* an invalid connection — it is a
 * replacement, which is what dropping a second wire on one input means in a
 * node editor. The ids come back so the caller can drop them in the same edit
 * as the add, where the unsaved-changes diff reports the disconnect alongside
 * the connect rather than the wire silently vanishing.
 */
const occupyingEdgeIds = (
  connection: Connection | Edge,
  targetNode: Node<PipelineNodeData> | undefined,
  edges: Array<Pick<Edge, "id" | "target" | "targetHandle">> | undefined,
): string[] => {
  if (!targetNode || !edges || !connection.targetHandle) return [];
  const port = targetNode.data.inputs.find((entry) => entry.key === connection.targetHandle);
  if (!port || port.accepts_many) return [];
  const connectionId = "id" in connection ? connection.id : undefined;
  return edges
    .filter(
      (edge) =>
        edge.id !== connectionId &&
        edge.target === connection.target &&
        (edge.targetHandle ?? "default") === connection.targetHandle,
    )
    .map((edge) => edge.id);
};

export type PipelineConnectionValidation = {
  valid: boolean;
  /** Why the connection is meaningless — type/facet mismatch, self-connection. */
  reason?: string;
  /** Existing edges this drop replaces; empty unless the target port is taken. */
  replaces?: string[];
};

export const validatePipelineConnection = (
  connection: Connection | Edge,
  nodes: Node<PipelineNodeData>[],
  configOverrides?: Record<string, Record<string, unknown>>,
  edges?: Array<
    Pick<Edge, "id" | "source" | "target"> & Partial<Pick<Edge, "sourceHandle" | "targetHandle">>
  >,
): PipelineConnectionValidation => {
  if (!connection.source || !connection.target) {
    return { valid: false, reason: "Connections must have both a source and a target." };
  }
  if (connection.source === connection.target) {
    return { valid: false, reason: "Nodes cannot connect to themselves." };
  }
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  const sourcePort = resolvePort(sourceNode, connection.sourceHandle, "output");
  const targetPort = resolvePort(targetNode, connection.targetHandle, "input");

  if (!sourcePort || !targetPort) {
    return { valid: false, reason: "Connections must specify compatible ports." };
  }

  if (sourcePort.data_type !== targetPort.data_type) {
    return {
      valid: false,
      reason: `Cannot connect ${sourcePort.data_type} to ${targetPort.data_type}.`,
    };
  }

  if (targetPort.data_type === ITEMS_KIND && targetPort.requires.length > 0) {
    const facetError = validateItemFacets(connection, nodes, targetPort.requires, edges);
    if (facetError) {
      return { valid: false, reason: facetError };
    }
  }

  const dimensionError = validateDimensionConnection(sourceNode, targetNode, configOverrides);
  if (dimensionError) {
    return { valid: false, reason: dimensionError };
  }

  return { valid: true, replaces: occupyingEdgeIds(connection, targetNode, edges) };
};

export const validatePipelineEdges = (
  nodes: Node<PipelineNodeData>[],
  edges: Array<
    { id: string; source: string; target: string } & Partial<
      Pick<Edge, "sourceHandle" | "targetHandle">
    >
  >,
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edgeErrors: Record<string, string> = {};
  const nodeErrors: Record<string, string[]> = {};
  const addError = (edgeId: string, targetId: string | undefined, message: string) => {
    edgeErrors[edgeId] = message;
    if (targetId) {
      nodeErrors[targetId] = [...(nodeErrors[targetId] ?? []), message];
    }
  };

  edges.forEach((edge) => {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);
    const dimensionError = validateDimensionConnection(sourceNode, targetNode, configOverrides);
    if (!dimensionError) return;
    addError(edge.id, targetNode?.id, dimensionError);
  });

  facetIssues(toFacetNodePorts(nodes), toFacetEdges(edges)).forEach((issue) => {
    addError(
      issue.edgeId,
      issue.target,
      `This connection delivers items without ${issue.missing.join(", ")}.`,
    );
  });

  return { edgeErrors, nodeErrors };
};

const resolveIndexName = (config: Record<string, unknown>) => {
  const value = config.index_name;
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  // An expression-valued index name counts as set here; the server validates
  // it statically (type + the static-only taint rule).
  if (expressionSource(value)) {
    return "expression";
  }
  return "";
};

export const validatePipelineConfig = (
  nodes: Node<PipelineNodeData>[],
  configOverrides?: Record<string, Record<string, unknown>>,
) => {
  const nodeErrors: Record<string, string[]> = {};
  nodes.forEach((node) => {
    const { nodeType } = node.data;
    const config = resolveNodeConfig(node, configOverrides);
    if (nodeType.startsWith("chunker.") && config.tokenizer === "huggingface") {
      const modelId = config.hf_model_id;
      if (typeof modelId !== "string" || !modelId.trim()) {
        nodeErrors[node.id] = ["A HuggingFace model id is required."];
      }
    }
    if (!nodeType.startsWith("indexer.") && !nodeType.startsWith("retriever.")) {
      return;
    }
    if (!resolveIndexName(config)) {
      nodeErrors[node.id] = ["An index is required. Select an index or create a new one."];
    }
  });
  return { nodeErrors };
};
