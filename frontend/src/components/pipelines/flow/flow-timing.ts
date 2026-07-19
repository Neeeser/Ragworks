import { resolveNodeDimensions } from "../lib/pipeline-layout";

import type { PipelineNodeData } from "../PipelineNode";
import type { Node } from "@xyflow/react";

/** Corner radius of the node card (rounded-2xl = 1rem). */
export const BEAM_CORNER_RADIUS = 16;

/**
 * Length of one node beam route: entry midpoint → around the top (or bottom)
 * of the card → exit midpoint. Straight legs cover width + height − 4r and
 * the two quarter-corners add πr/2 each.
 */
export const beamPathLength = (width: number, height: number): number => {
  const radius = Math.min(BEAM_CORNER_RADIUS, width / 2, height / 2);
  return width + height + (Math.PI - 4) * radius;
};

/**
 * The card the pacing props are calibrated against: `processMs` is how long
 * the beams take to round a typical 264×180 card, and every other duration
 * is scaled by geometry so the light always covers ground at that one speed
 * — a longer edge or taller card takes proportionally longer instead of the
 * light visibly speeding up.
 */
const REFERENCE_BEAM_LENGTH = beamPathLength(264, 180);

type EdgeRef = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/** Vertical center of a card's first port row (header + padding above it). */
const FIRST_PORT_CENTER_Y = 64;
const PORT_ROW_HEIGHT = 24;

/**
 * Estimated y of a handle inside its card: port rows sit at fixed offsets
 * under the fixed-height header, so anchoring at the row (not the card's
 * vertical midpoint) keeps straight wires between aligned ports measuring
 * straight instead of picking up a phantom vertical leg.
 */
const handleOffsetY = (
  ports: { key: string }[],
  handle: string | null | undefined,
  height: number,
): number => {
  if (ports.length === 0) return height / 2;
  const index = Math.max(
    0,
    ports.findIndex((port) => port.key === handle),
  );
  return Math.min(FIRST_PORT_CENTER_Y + index * PORT_ROW_HEIGHT, height);
};

export type FlowTiming = {
  /** Per-node beam duration: one constant-speed trip around that card. */
  processMsByNodeId: ReadonlyMap<string, number>;
  /** Per-edge comet duration: constant speed over the edge's length. */
  travelMsByEdgeId: ReadonlyMap<string, number>;
};

/**
 * Derive per-node and per-edge playback durations from graph geometry so the
 * flow moves at one continuous speed. Edge lengths are estimated as the
 * Manhattan distance between the source and target handles' port rows — the
 * smooth-step routes are orthogonal, so this tracks the real path closely
 * without waiting on the router.
 */
export const buildFlowTiming = (
  nodes: Node<PipelineNodeData>[],
  edges: EdgeRef[],
  processMs: number,
): FlowTiming => {
  const msPerPx = processMs / REFERENCE_BEAM_LENGTH;
  const geometry = new Map(
    nodes.map((node) => [
      node.id,
      { position: node.position, data: node.data, ...resolveNodeDimensions(node) },
    ]),
  );
  const processMsByNodeId = new Map<string, number>();
  for (const [id, { width, height }] of geometry) {
    processMsByNodeId.set(id, Math.round(beamPathLength(width, height) * msPerPx));
  }
  const travelMsByEdgeId = new Map<string, number>();
  for (const edge of edges) {
    const source = geometry.get(edge.source);
    const target = geometry.get(edge.target);
    if (!source || !target) continue;
    const sourceX = source.position.x + source.width;
    const sourceY =
      source.position.y + handleOffsetY(source.data.outputs, edge.sourceHandle, source.height);
    const targetX = target.position.x;
    const targetY =
      target.position.y + handleOffsetY(target.data.inputs, edge.targetHandle, target.height);
    // The rendered comet path is a near-constant ~14px shorter than the
    // card-edge-to-card-edge Manhattan estimate: handles anchor outside the
    // card, the comet extends only to the handle centers, and smooth-step
    // corner rounding shaves the bends. Uncorrected, short edges read ~10%
    // slower than the rest of the flow.
    const length = Math.max(Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY) - 14, 24);
    travelMsByEdgeId.set(edge.id, Math.round(length * msPerPx));
  }
  return { processMsByNodeId, travelMsByEdgeId };
};
