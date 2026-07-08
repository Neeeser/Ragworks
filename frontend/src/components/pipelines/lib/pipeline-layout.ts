import type { PipelineNodeData } from "../PipelineNode";
import type { Edge, Node } from "@xyflow/react";

/**
 * Layered left-to-right auto-layout for pipeline graphs.
 *
 * Pipelines are DAGs that read as an assembly line, so the layout mirrors
 * that: longest-path layering assigns each node a column, a barycenter pass
 * orders nodes within a column by where their inputs sit, and columns are
 * vertically centered so single-track pipelines form one straight line.
 */

export const ESTIMATED_NODE_WIDTH = 264;
export const LAYER_GAP_X = 104;
export const NODE_GAP_Y = 56;

/** Height estimate used for stacking and overlap checks (header + config rows). */
export const estimateNodeHeight = (
  data: Pick<PipelineNodeData, "config" | "inputs" | "outputs">,
) => {
  const configRows = Math.min(Object.keys(data.config ?? {}).length, 5);
  const portRows = Math.max(data.inputs.length, data.outputs.length);
  return 84 + configRows * 22 + portRows * 18;
};

type LayoutNode = Node<PipelineNodeData>;

const buildLayers = (nodes: LayoutNode[], edges: Edge[]): Map<string, number> => {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  nodes.forEach((node) => incoming.set(node.id, 0));
  edges.forEach((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  const layers = new Map<string, number>();
  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  queue.forEach((id) => layers.set(id, 0));
  const pending = new Map(incoming);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const layer = layers.get(id) ?? 0;
    (outgoing.get(id) ?? []).forEach((target) => {
      layers.set(target, Math.max(layers.get(target) ?? 0, layer + 1));
      const remaining = (pending.get(target) ?? 0) - 1;
      pending.set(target, remaining);
      if (remaining === 0) queue.push(target);
    });
  }
  // Nodes unreachable via Kahn (cycles, disconnected leftovers) fall into layer 0.
  nodes.forEach((node) => {
    if (!layers.has(node.id)) layers.set(node.id, 0);
  });
  return layers;
};

/** Return copies of `nodes` with fresh layered positions. */
export const layoutPipelineNodes = (nodes: LayoutNode[], edges: Edge[]): LayoutNode[] => {
  if (nodes.length === 0) return nodes;
  const layers = buildLayers(nodes, edges);
  const columns = new Map<number, LayoutNode[]>();
  nodes.forEach((node) => {
    const layer = layers.get(node.id) ?? 0;
    columns.set(layer, [...(columns.get(layer) ?? []), node]);
  });

  // Barycenter ordering: sort each column by the average row of its sources.
  const rowIndex = new Map<string, number>();
  const sortedLayers = [...columns.keys()].sort((a, b) => a - b);
  sortedLayers.forEach((layer) => {
    const column = columns.get(layer) ?? [];
    const scored = column.map((node, index) => {
      const sourceRows = edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => rowIndex.get(edge.source))
        .filter((row): row is number => typeof row === "number");
      const score =
        sourceRows.length > 0
          ? sourceRows.reduce((sum, row) => sum + row, 0) / sourceRows.length
          : index;
      return { node, score, index };
    });
    scored.sort((a, b) => a.score - b.score || a.index - b.index);
    scored.forEach((entry, index) => rowIndex.set(entry.node.id, index));
    columns.set(
      layer,
      scored.map((entry) => entry.node),
    );
  });

  const positioned = new Map<string, { x: number; y: number }>();
  sortedLayers.forEach((layer) => {
    const column = columns.get(layer) ?? [];
    const heights = column.map((node) => estimateNodeHeight(node.data));
    const totalHeight =
      heights.reduce((sum, height) => sum + height, 0) + NODE_GAP_Y * (column.length - 1);
    let y = -totalHeight / 2;
    column.forEach((node, index) => {
      positioned.set(node.id, {
        x: layer * (ESTIMATED_NODE_WIDTH + LAYER_GAP_X),
        y,
      });
      y += heights[index] + NODE_GAP_Y;
    });
  });

  return nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) ?? node.position,
  }));
};

const rectsOverlap = (
  a: { x: number; y: number; height: number },
  b: { x: number; y: number; height: number },
) => {
  const margin = 12;
  return (
    a.x < b.x + ESTIMATED_NODE_WIDTH - margin &&
    b.x < a.x + ESTIMATED_NODE_WIDTH - margin &&
    a.y < b.y + b.height - margin &&
    b.y < a.y + a.height - margin
  );
};

/**
 * Whether a loaded definition needs auto-layout: any node without a saved
 * position, every node piled at the origin, or overlapping cards (the old
 * scaffolds placed nodes closer together than the cards render).
 */
export const needsAutoLayout = (nodes: LayoutNode[]): boolean => {
  if (nodes.length < 2) return false;
  const allAtOrigin = nodes.every((node) => node.position.x === 0 && node.position.y === 0);
  if (allAtOrigin) return true;
  const rects = nodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    height: estimateNodeHeight(node.data),
  }));
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) return true;
    }
  }
  return false;
};
