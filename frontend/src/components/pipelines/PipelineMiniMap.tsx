"use client";

import {
  getNodeFamilyColorVar,
  resolveNodeFamily,
} from "@/components/pipelines/lib/pipeline-theme";

import type { PipelineDefinition } from "@/lib/types";

type PlacedNode = {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
};

type MiniMapLayout = {
  nodes: PlacedNode[];
  edges: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }>;
  width: number;
  height: number;
};

const COL_W = 64;
const ROW_H = 34;
const PAD = 14;

/**
 * Place nodes on a layered grid: each node's column is its longest path from
 * a source, rows spread a column's nodes evenly. Deterministic and cheap —
 * saved editor positions are ignored so every preview reads left-to-right.
 */
export function layoutDefinition(definition: PipelineDefinition): MiniMapLayout {
  const layerOf = new Map<string, number>();
  for (const node of definition.nodes) {
    layerOf.set(node.id, 0);
  }
  // Relax edges nodes² times at most — plenty for pipeline-sized graphs and
  // safe against cycles (which the validator rejects anyway).
  for (let pass = 0; pass < definition.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of definition.edges) {
      const source = layerOf.get(edge.source);
      const target = layerOf.get(edge.target);
      if (source === undefined || target === undefined) continue;
      if (source + 1 > target) {
        layerOf.set(edge.target, source + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, string[]>();
  for (const node of definition.nodes) {
    const layer = layerOf.get(node.id) ?? 0;
    columns.set(layer, [...(columns.get(layer) ?? []), node.id]);
  }
  const layerCount = Math.max(1, columns.size);
  const tallest = Math.max(1, ...Array.from(columns.values(), (ids) => ids.length));
  const height = PAD * 2 + (tallest - 1) * ROW_H;

  const placed = new Map<string, PlacedNode>();
  for (const node of definition.nodes) {
    const layer = layerOf.get(node.id) ?? 0;
    const siblings = columns.get(layer) ?? [node.id];
    const row = siblings.indexOf(node.id);
    const spread = (siblings.length - 1) * ROW_H;
    placed.set(node.id, {
      id: node.id,
      name: node.name,
      color: getNodeFamilyColorVar(resolveNodeFamily(node.type)),
      x: PAD + layer * COL_W,
      y: height / 2 - spread / 2 + row * ROW_H,
    });
  }

  return {
    nodes: Array.from(placed.values()),
    edges: definition.edges.flatMap((edge) => {
      const source = placed.get(edge.source);
      const target = placed.get(edge.target);
      if (!source || !target) return [];
      return [
        {
          id: edge.id,
          x1: source.x,
          y1: source.y,
          x2: target.x,
          y2: target.y,
          color: source.color,
        },
      ];
    }),
    width: PAD * 2 + (layerCount - 1) * COL_W,
    height,
  };
}

type PipelineMiniMapProps = {
  definition: PipelineDefinition;
  className?: string;
};

/** A read-only thumbnail of a pipeline graph, colored by stage. */
export function PipelineMiniMap({ definition, className }: PipelineMiniMapProps) {
  const layout = layoutDefinition(definition);
  if (layout.nodes.length === 0) {
    return <p className="text-xs text-muted">Empty pipeline.</p>;
  }
  return (
    <svg
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className={className}
      role="img"
      aria-label="Pipeline preview"
      preserveAspectRatio="xMidYMid meet"
    >
      {layout.edges.map((edge) => (
        <path
          key={edge.id}
          d={`M${edge.x1},${edge.y1} C${(edge.x1 + edge.x2) / 2},${edge.y1} ${(edge.x1 + edge.x2) / 2},${edge.y2} ${edge.x2},${edge.y2}`}
          fill="none"
          style={{ stroke: edge.color }}
          strokeWidth={1.5}
          opacity={0.45}
        />
      ))}
      {layout.nodes.map((node) => (
        <circle key={node.id} cx={node.x} cy={node.y} r={5} style={{ fill: node.color }}>
          <title>{node.name}</title>
        </circle>
      ))}
    </svg>
  );
}
