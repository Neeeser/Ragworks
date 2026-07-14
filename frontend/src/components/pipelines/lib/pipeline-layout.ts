import { countHiddenOverrides, resolveNodeSignature } from "./node-signature";
import { buildPipelineConfigFields } from "./pipeline-config";

import type { PipelineNodeData } from "../PipelineNode";
import type { Edge, Node } from "@xyflow/react";

/**
 * Deterministic left-to-right layout for pipeline DAGs.
 *
 * Longest-path layering establishes the flow direction, alternating barycenter
 * sweeps reduce crossings, and adjacent-node centering positions fan-outs and
 * merges relative to every connected branch. Weakly connected components are
 * laid out independently and packed into deterministic, bounded shelves.
 */

export const ESTIMATED_NODE_WIDTH = 264;
export const LAYER_GAP_X = 104;
export const NODE_GAP_Y = 56;
export const COMPONENT_GAP_X = 104;
export const COMPONENT_GAP_Y = 112;

/** Safe pre-measurement height estimate for the rendered card. */
export const estimateNodeHeight = (
  data: Pick<PipelineNodeData, "config" | "configSchema" | "inputs" | "nodeType" | "outputs">,
) => {
  const portRows = Math.max(data.inputs.length, data.outputs.length);
  const fields = buildPipelineConfigFields(data.configSchema);
  const signature = resolveNodeSignature(data.nodeType, data.config ?? {}, fields);
  const hiddenOverrides = countHiddenOverrides(
    data.config ?? {},
    fields,
    signature?.consumedKeys ?? [],
  );
  return (
    68 +
    portRows * 24 +
    (signature ? (signature.detail ? 64 : 56) : 0) +
    (hiddenOverrides > 0 ? 24 : 0)
  );
};

type LayoutNode = Node<PipelineNodeData>;
export type NodeDimensions = { width: number; height: number };

/** Prefer React Flow's live measurement, with conservative pre-render fallbacks. */
export const resolveNodeDimensions = (node: LayoutNode): NodeDimensions => ({
  width: node.measured?.width ?? node.width ?? ESTIMATED_NODE_WIDTH,
  height: node.measured?.height ?? node.height ?? estimateNodeHeight(node.data),
});

type Relations = {
  predecessors: Map<string, string[]>;
  successors: Map<string, string[]>;
  neighbors: Map<string, string[]>;
  order: Map<string, number>;
};

const buildRelations = (nodes: LayoutNode[], edges: Edge[]): Relations => {
  const ids = new Set(nodes.map((node) => node.id));
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  const neighbors = new Map<string, string[]>();
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  nodes.forEach((node) => {
    predecessors.set(node.id, []);
    successors.set(node.id, []);
    neighbors.set(node.id, []);
  });
  edges.forEach(({ source, target }) => {
    if (!ids.has(source) || !ids.has(target)) return;
    predecessors.get(target)!.push(source);
    successors.get(source)!.push(target);
    neighbors.get(source)!.push(target);
    neighbors.get(target)!.push(source);
  });
  const stable = (idsToSort: string[]) => idsToSort.sort((a, b) => order.get(a)! - order.get(b)!);
  nodes.forEach((node) => {
    stable(predecessors.get(node.id)!);
    stable(successors.get(node.id)!);
    stable(neighbors.get(node.id)!);
  });
  return { predecessors, successors, neighbors, order };
};

const findComponents = (nodes: LayoutNode[], relations: Relations): string[][] => {
  const visited = new Set<string>();
  const components: string[][] = [];
  nodes.forEach((node) => {
    if (visited.has(node.id)) return;
    const component: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      component.push(id);
      (relations.neighbors.get(id) ?? []).forEach((neighbor) => {
        if (visited.has(neighbor)) return;
        visited.add(neighbor);
        queue.push(neighbor);
      });
    }
    component.sort((a, b) => relations.order.get(a)! - relations.order.get(b)!);
    components.push(component);
  });
  return components;
};

const buildLayers = (component: string[], relations: Relations): Map<string, number> => {
  const componentIds = new Set(component);
  const pending = new Map<string, number>();
  component.forEach((id) => {
    const count = (relations.predecessors.get(id) ?? []).filter((source) =>
      componentIds.has(source),
    ).length;
    pending.set(id, count);
  });
  const queue = component.filter((id) => pending.get(id) === 0);
  const layers = new Map(queue.map((id) => [id, 0]));
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const nextLayer = (layers.get(id) ?? 0) + 1;
    (relations.successors.get(id) ?? []).forEach((target) => {
      if (!componentIds.has(target)) return;
      layers.set(target, Math.max(layers.get(target) ?? 0, nextLayer));
      const remaining = (pending.get(target) ?? 0) - 1;
      pending.set(target, remaining);
      if (remaining === 0) queue.push(target);
    });
  }
  component.forEach((id) => {
    if (!layers.has(id)) layers.set(id, 0);
  });
  return layers;
};

const makeColumns = (
  component: string[],
  layers: Map<string, number>,
  relations: Relations,
): string[][] => {
  const maxLayer = Math.max(...layers.values());
  const columns = Array.from({ length: maxLayer + 1 }, () => [] as string[]);
  component.forEach((id) => columns[layers.get(id) ?? 0].push(id));
  columns.forEach((column) =>
    column.sort((a, b) => relations.order.get(a)! - relations.order.get(b)!),
  );
  return columns;
};

const rowIndexes = (columns: string[][]): Map<string, number> => {
  const rows = new Map<string, number>();
  columns.forEach((column) => column.forEach((id, index) => rows.set(id, index)));
  return rows;
};

const reorderColumn = (
  column: string[],
  adjacent: Map<string, string[]>,
  rows: Map<string, number>,
  relations: Relations,
) => {
  const original = new Map(column.map((id, index) => [id, index]));
  column.sort((left, right) => {
    const score = (id: string) => {
      const connectedRows = (adjacent.get(id) ?? [])
        .map((neighbor) => rows.get(neighbor))
        .filter((row): row is number => row !== undefined);
      if (connectedRows.length === 0) return original.get(id)!;
      return connectedRows.reduce((sum, row) => sum + row, 0) / connectedRows.length;
    };
    return score(left) - score(right) || relations.order.get(left)! - relations.order.get(right)!;
  });
};

const minimizeCrossings = (columns: string[][], relations: Relations) => {
  for (let pass = 0; pass < 4; pass += 1) {
    let rows = rowIndexes(columns);
    for (let layer = 1; layer < columns.length; layer += 1) {
      reorderColumn(columns[layer], relations.predecessors, rows, relations);
      rows = rowIndexes(columns);
    }
    rows = rowIndexes(columns);
    for (let layer = columns.length - 2; layer >= 0; layer -= 1) {
      reorderColumn(columns[layer], relations.successors, rows, relations);
      rows = rowIndexes(columns);
    }
  }
};

const averageCenter = (ids: string[], centers: Map<string, number>): number | undefined => {
  const values = ids
    .map((id) => centers.get(id))
    .filter((center): center is number => center !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, center) => sum + center, 0) / values.length;
};

// Nodes are aligned by their TOP edge, not their vertical center: cards have
// fixed-height headers with port rows directly under them, so equal tops make
// matching ports share a y coordinate and straight runs render as straight
// wires. Centering by card middle staggers mixed-height rows for no benefit
// (the constant offset cancels out of every neighbor average anyway).
const packColumn = (
  column: string[],
  desired: Map<string, number>,
  heights: Map<string, number>,
): Map<string, number> => {
  const centers = new Map<string, number>();
  column.forEach((id, index) => {
    let center = desired.get(id) ?? 0;
    if (index > 0) {
      const previous = column[index - 1];
      const clearance = heights.get(previous)! + NODE_GAP_Y;
      center = Math.max(center, centers.get(previous)! + clearance);
    }
    centers.set(id, center);
  });
  const recenter =
    column.reduce((sum, id) => sum + (desired.get(id) ?? 0) - centers.get(id)!, 0) / column.length;
  column.forEach((id) => centers.set(id, centers.get(id)! + recenter));
  return centers;
};

const positionColumns = (
  columns: string[][],
  relations: Relations,
  heights: Map<string, number>,
): Map<string, number> => {
  const centers = new Map<string, number>();
  const sweep = (forward: boolean) => {
    const start = forward ? 0 : columns.length - 1;
    const end = forward ? columns.length : -1;
    const step = forward ? 1 : -1;
    for (let layer = start; layer !== end; layer += step) {
      const desired = new Map<string, number>();
      columns[layer].forEach((id) => {
        const adjacent = forward
          ? (relations.predecessors.get(id) ?? [])
          : (relations.successors.get(id) ?? []);
        desired.set(id, averageCenter(adjacent, centers) ?? centers.get(id) ?? 0);
      });
      packColumn(columns[layer], desired, heights).forEach((center, id) => centers.set(id, center));
    }
  };
  sweep(true);
  sweep(false);
  sweep(true);
  return centers;
};

const layoutComponent = (
  component: string[],
  nodesById: Map<string, LayoutNode>,
  relations: Relations,
) => {
  const layers = buildLayers(component, relations);
  const columns = makeColumns(component, layers, relations);
  minimizeCrossings(columns, relations);
  const dimensions = new Map(
    component.map((id) => [id, resolveNodeDimensions(nodesById.get(id)!)]),
  );
  const heights = new Map(component.map((id) => [id, dimensions.get(id)!.height]));
  const centers = positionColumns(columns, relations, heights);
  const top = Math.min(...component.map((id) => centers.get(id)!));
  const bottom = Math.max(...component.map((id) => centers.get(id)! + heights.get(id)!));
  const columnWidths = columns.map((column) =>
    Math.max(...column.map((id) => dimensions.get(id)!.width)),
  );
  const columnLefts = columnWidths.map((_width, index) =>
    columnWidths.slice(0, index).reduce((sum, width) => sum + width + LAYER_GAP_X, 0),
  );
  return {
    width: columnLefts.at(-1)! + columnWidths.at(-1)!,
    height: bottom - top,
    positions: new Map(
      component.map((id) => [
        id,
        {
          x: columnLefts[layers.get(id) ?? 0],
          y: centers.get(id)! - top,
        },
      ]),
    ),
  };
};

/** Return copies of `nodes` with fresh layered positions. */
export const layoutPipelineNodes = (nodes: LayoutNode[], edges: Edge[]): LayoutNode[] => {
  if (nodes.length === 0) return nodes;
  const relations = buildRelations(nodes, edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positioned = new Map<string, { x: number; y: number }>();
  const layouts = findComponents(nodes, relations).map((component) =>
    layoutComponent(component, nodesById, relations),
  );
  const paddedArea = layouts.reduce(
    (sum, layout) => sum + (layout.width + COMPONENT_GAP_X) * (layout.height + COMPONENT_GAP_Y),
    0,
  );
  const shelfWidth = Math.max(
    ...layouts.map((layout) => layout.width),
    Math.ceil(Math.sqrt(paddedArea * 1.6)),
  );
  let shelfLeft = 0;
  let shelfTop = 0;
  let shelfHeight = 0;
  layouts.forEach((layout) => {
    if (shelfLeft > 0 && shelfLeft + layout.width > shelfWidth) {
      shelfLeft = 0;
      shelfTop += shelfHeight + COMPONENT_GAP_Y;
      shelfHeight = 0;
    }
    layout.positions.forEach(({ x, y }, id) =>
      positioned.set(id, { x: x + shelfLeft, y: y + shelfTop }),
    );
    shelfLeft += layout.width + COMPONENT_GAP_X;
    shelfHeight = Math.max(shelfHeight, layout.height);
  });
  return nodes.map((node) => ({
    ...node,
    position: positioned.get(node.id) ?? node.position,
  }));
};

const rectsOverlap = (
  a: { x: number; y: number; height: number; width: number },
  b: { x: number; y: number; height: number; width: number },
) => {
  const margin = 12;
  return (
    a.x < b.x + b.width - margin &&
    b.x < a.x + a.width - margin &&
    a.y < b.y + b.height - margin &&
    b.y < a.y + a.height - margin
  );
};

/**
 * Whether a loaded definition needs auto-layout: any node without a saved
 * position, every node piled at the origin, or overlapping cards.
 */
export const needsAutoLayout = (nodes: LayoutNode[]): boolean => {
  if (nodes.length < 2) return false;
  const allAtOrigin = nodes.every((node) => node.position.x === 0 && node.position.y === 0);
  if (allAtOrigin) return true;
  const rects = nodes.map((node) => ({ ...node.position, ...resolveNodeDimensions(node) }));
  for (let first = 0; first < rects.length; first += 1) {
    for (let second = first + 1; second < rects.length; second += 1) {
      if (rectsOverlap(rects[first], rects[second])) return true;
    }
  }
  return false;
};
