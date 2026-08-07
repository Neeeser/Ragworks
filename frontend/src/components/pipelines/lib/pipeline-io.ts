import { expressionSource } from "@/lib/expressions";

import { withConfiguredRemoves } from "./configured-removes";
import { ITEMS_KIND, facetIssues, inferOutputFacets } from "./facet-inference";
import { findGraphCycles } from "./graph-cycles";
import { stableModalityIssues } from "./modality";

import type { FacetEdge, FacetNodePorts } from "./facet-inference";
import type { NodeLabels } from "./modality";
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
  new Map(
    nodes.map((node) => [
      node.id,
      { inputs: node.data.inputs, outputs: withConfiguredRemoves(node) },
    ]),
  );

/** What a modality finding calls each node — its editor label, else its type. */
const toNodeLabels = (nodes: Node<PipelineNodeData>[]): NodeLabels =>
  new Map(nodes.map((node) => [node.id, node.data.label || node.data.nodeType]));

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

/** Facets the target demands that this source's stream cannot guarantee. */
const missingItemFacets = (
  connection: Connection | Edge,
  nodes: Node<PipelineNodeData>[],
  targetRequires: readonly string[],
  edges?: readonly FacetEdgeSource[],
): string[] => {
  const guarantees = inferOutputFacets(toFacetNodePorts(nodes), toFacetEdges(edges ?? [])).get(
    `${connection.source}.${connection.sourceHandle}`,
  );
  // An unresolved source (cycle mid-edit) defers to server validation.
  if (!guarantees) return [];
  return [...targetRequires].filter((facet) => !guarantees.has(facet)).sort();
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
  /**
   * Facets the target requires that the source cannot guarantee. Carried
   * structurally, not only inside `reason`, so the editor can name the node
   * that supplies them instead of re-parsing its own prose.
   */
  missing?: string[];
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
    const missing = missingItemFacets(connection, nodes, targetPort.requires, edges);
    if (missing.length > 0) {
      return {
        valid: false,
        reason: `This connection delivers items without ${missing.join(", ")}.`,
        missing,
      };
    }
  }

  const dimensionError = validateDimensionConnection(sourceNode, targetNode, configOverrides);
  if (dimensionError) {
    return { valid: false, reason: dimensionError };
  }

  return { valid: true, replaces: occupyingEdgeIds(connection, targetNode, edges) };
};

/**
 * Live wire-drag context: which handles this drag may actually land on.
 *
 * The sets are computed once per drag from the same `validatePipelineConnection`
 * the drop is gated by, so a handle can never light up and then refuse — a hint
 * derived from a looser rule than the gate is worse than no hint, because the
 * user learns to trust it.
 */
export type ConnectingContext = {
  /** Which side was picked up: a source handle looks for targets, and vice versa. */
  from: "source" | "target";
  nodeId: string;
  /** Port refs (`"nodeId.portKey"`) the validator accepts for this drag. */
  valid: ReadonlySet<string>;
  /** Refs within `valid` whose drop replaces the edge already wired there. */
  replaces: ReadonlySet<string>;
};

/**
 * Every handle the picked-up one may connect to, and which of those drops
 * would cost the user an existing wire.
 */
export const connectionTargets = (
  nodes: Node<PipelineNodeData>[],
  edges: Array<
    Pick<Edge, "id" | "source" | "target"> & Partial<Pick<Edge, "sourceHandle" | "targetHandle">>
  >,
  origin: { nodeId: string; portKey: string; from: "source" | "target" },
): Pick<ConnectingContext, "valid" | "replaces"> => {
  const valid = new Set<string>();
  const replaces = new Set<string>();
  for (const node of nodes) {
    if (node.id === origin.nodeId) continue;
    const ports = origin.from === "source" ? node.data.inputs : node.data.outputs;
    for (const port of ports ?? []) {
      const connection =
        origin.from === "source"
          ? {
              source: origin.nodeId,
              sourceHandle: origin.portKey,
              target: node.id,
              targetHandle: port.key,
            }
          : {
              source: node.id,
              sourceHandle: port.key,
              target: origin.nodeId,
              targetHandle: origin.portKey,
            };
      const result = validatePipelineConnection(connection, nodes, undefined, edges);
      if (!result.valid) continue;
      const ref = `${node.id}.${port.key}`;
      valid.add(ref);
      if ((result.replaces?.length ?? 0) > 0) replaces.add(ref);
    }
  }
  return { valid, replaces };
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

  // A loop makes the pipeline unrunnable, and the server only says so on save
  // — minutes of work after the wire was drawn. Every edge in the loop is
  // marked, because any of them is a valid place to cut it.
  const cycles = findGraphCycles(edges.map(({ id, source, target }) => ({ id, source, target })));
  if (cycles.edgeIds.size > 0) {
    const named = (nodeId: string) => nodeMap.get(nodeId)?.data.label || nodeId;
    const message = cycles.paths
      .map((path) => `This connection creates a loop: ${path.map(named).join(" → ")}.`)
      .join(" ");
    edges.forEach((edge) => {
      if (cycles.edgeIds.has(edge.id)) addError(edge.id, edge.target, message);
    });
  }

  // Instant modality errors, restricted to findings no model choice can cure
  // (a node whose model widens its accepts is analyzed as if it accepted
  // everything) — the model-dependent findings arrive with the debounced
  // server validation instead of flashing a false error until it answers.
  const widens = new Set(
    nodes.filter((node) => node.data.modelWidensAccepts).map((node) => node.id),
  );
  stableModalityIssues(toFacetNodePorts(nodes), toFacetEdges(edges), widens, toNodeLabels(nodes))
    .filter((issue) => issue.severity === "error")
    .forEach((issue) => {
      nodeErrors[issue.nodeId] = [...(nodeErrors[issue.nodeId] ?? []), issue.message];
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

/**
 * Node types whose model is a required setting, and what the node is called.
 *
 * A model-backed node with no model is exactly as unrunnable as a store-bound
 * node with no index, so it reports on the same frame rather than a debounce
 * later when the server pass answers — two node types refusing at different
 * moments reads as one of them being fine.
 */
const MODEL_BACKED_NODES: Record<string, string> = {
  "embedder.text": "An embedding model",
  "reranker.model": "A reranking model",
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
    const modelRequirement = MODEL_BACKED_NODES[nodeType];
    if (modelRequirement) {
      const modelName = config.model_name;
      if (typeof modelName !== "string" || !modelName.trim()) {
        nodeErrors[node.id] = [`${modelRequirement} is required. Select one.`];
      } else if (!config.connection_id) {
        nodeErrors[node.id] = ["A provider connection is required. Select one."];
      }
      return;
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
