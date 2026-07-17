import { resolveNodeDescription, resolveNodeExample } from "./node-content";
import { ESTIMATED_NODE_WIDTH, LAYER_GAP_X } from "./pipeline-layout";
import { getNodeFamilyOrder, resolveNodeFamily, type NodeFamily } from "./pipeline-theme";

import type { TypedEdgeType } from "../flow/TypedEdge";
import type { PipelineNodeData } from "../PipelineNode";
import type { NodeSpec, PipelineDefinition, PipelineVariable, VectorIndex } from "@/lib/types";
import type { Node } from "@xyflow/react";

export const createId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

export const toFlowNodes = (
  definition: PipelineDefinition,
  specs: NodeSpec[],
): Node<PipelineNodeData>[] =>
  definition.nodes.map((node) => {
    const spec = specs.find((item) => item.type === node.type);
    return {
      id: node.id,
      type: "pipelineNode",
      position: node.position ?? { x: 0, y: 0 },
      data: {
        label: node.name,
        nodeType: node.type,
        description: spec ? resolveNodeDescription(spec) : undefined,
        example: spec ? resolveNodeExample(spec) : undefined,
        inputs: spec?.input_ports ?? [],
        outputs: spec?.output_ports ?? [],
        config: node.config ?? {},
        configSchema: spec?.config_schema ?? {},
      },
    };
  });

/**
 * Convert definition edges to typed flow edges. The wire's color comes from
 * the data type leaving the source port, resolved via the node specs.
 */
export const toFlowEdges = (definition: PipelineDefinition, specs: NodeSpec[]): TypedEdgeType[] =>
  definition.edges.map((edge) => {
    const sourceNode = definition.nodes.find((node) => node.id === edge.source);
    const spec = sourceNode ? specs.find((item) => item.type === sourceNode.type) : undefined;
    const port = spec?.output_ports.find((entry) => entry.key === edge.source_port);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_port ?? undefined,
      targetHandle: edge.target_port ?? undefined,
      type: "typed" as const,
      data: { dataType: port?.data_type ?? spec?.output_ports[0]?.data_type },
    };
  });

export const toPipelineDefinition = (
  nodes: Node<PipelineNodeData>[],
  edges: TypedEdgeType[],
  variables: PipelineVariable[] = [],
): PipelineDefinition => ({
  nodes: nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.label,
    config: node.data.config,
    position: { x: node.position.x, y: node.position.y },
  })),
  edges: edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    source_port: edge.sourceHandle ?? undefined,
    target_port: edge.targetHandle ?? undefined,
  })),
  viewport: {},
  variables,
});

export const buildNodeCatalog = (specs: NodeSpec[]) => {
  const catalog = specs.reduce<Record<NodeFamily, NodeSpec[]>>(
    (acc, spec) => {
      const family = resolveNodeFamily(spec.type);
      acc[family] = acc[family] ?? [];
      acc[family].push(spec);
      return acc;
    },
    {} as Record<NodeFamily, NodeSpec[]>,
  );
  const order = getNodeFamilyOrder();
  return order
    .filter((family) => catalog[family]?.length)
    .map((family) => ({
      family,
      /* c8 ignore next -- filter ensures a family has specs */
      specs: catalog[family] ?? [],
    }));
};

/** Place a new node one column to the right of the current graph. */
export const nextNodePosition = (nodes: Node<PipelineNodeData>[]) => {
  if (nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const rightmost = nodes.filter((node) => node.position.x === maxX);
  const avgY = rightmost.reduce((sum, node) => sum + node.position.y, 0) / rightmost.length;
  return { x: maxX + ESTIMATED_NODE_WIDTH + LAYER_GAP_X, y: avgY };
};

/** Builds the flow-node `data` payload for a node spec, shared by the sidebar's drag
 * preview node and by the node actually added to the canvas. */
export const specToNodeData = (spec: NodeSpec): PipelineNodeData => ({
  label: spec.label,
  nodeType: spec.type,
  description: resolveNodeDescription(spec),
  example: resolveNodeExample(spec),
  inputs: spec.input_ports,
  outputs: spec.output_ports,
  config: spec.default_config ?? {},
  configSchema: spec.config_schema ?? {},
});

/** Sorts vector indexes alphabetically by name; used anywhere an index <select> needs a
 * stable, human-friendly ordering. */
export const sortIndexesByName = <T extends Pick<VectorIndex, "name">>(indexes: T[]): T[] =>
  [...indexes].sort((a, b) => a.name.localeCompare(b.name));
