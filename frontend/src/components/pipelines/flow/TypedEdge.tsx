"use client";

import { BaseEdge, getSmoothStepPath, Position } from "@xyflow/react";

import { getPortTypeColorVar } from "../lib/pipeline-theme";

import { usePipelineEdgeRoute } from "./PipelineEdgeRoutingProvider";

import type { Edge, EdgeProps } from "@xyflow/react";

export { PIPELINE_EDGE_ROUTING_OPTIONS } from "./PipelineEdgeRoutingProvider";

export type TypedEdgeData = {
  /** Port data type leaving the source handle; colors the wire. */
  dataType?: string;
  /** Trace playback: this edge is the one the payload is crossing right now. */
  active?: boolean;
  /** Trace playback: run the payload dot along the path (implies active). */
  traveling?: boolean;
  /** Duration of one dot crossing, in ms. */
  travelMs?: number;
  /** Playback edges already crossed stay softly lit. */
  visited?: boolean;
  /** Editor validation error on this connection. */
  error?: boolean;
};

export type TypedEdgeType = Edge<TypedEdgeData, "typed">;

type EdgeCoordinates = Pick<
  EdgeProps<TypedEdgeType>,
  "sourceX" | "sourceY" | "targetX" | "targetY" | "sourcePosition" | "targetPosition"
>;

const resolveEdgePath = (
  route: ReturnType<typeof usePipelineEdgeRoute>,
  coordinates: EdgeCoordinates,
) => {
  if (route) return route.svgPathString;
  return getSmoothStepPath({ ...coordinates, borderRadius: 6 })[0];
};

/** Half of PipelineNode's 12px port handle (the visible gray dot). */
const HANDLE_RADIUS = 6;

/** Offset from a handle's edge anchor toward its visual center. */
const towardHandleCenter = (position: Position | undefined): { x: number; y: number } => {
  if (position === Position.Left) return { x: HANDLE_RADIUS, y: 0 };
  if (position === Position.Right) return { x: -HANDLE_RADIUS, y: 0 };
  if (position === Position.Top) return { x: 0, y: HANDLE_RADIUS };
  return { x: 0, y: -HANDLE_RADIUS };
};

/**
 * The payload dot's motion path. React Flow anchors edges at the handle's
 * outer edge while the visible port dot is centered one handle-radius
 * inward — a dot frozen at the raw path end rests visibly offset beside the
 * gray handle dot, so the travel path is extended to both handle centers.
 */
const buildDotPath = (path: string, coordinates: EdgeCoordinates) => {
  const start = towardHandleCenter(coordinates.sourcePosition);
  const end = towardHandleCenter(coordinates.targetPosition);
  const startX = coordinates.sourceX + start.x;
  const startY = coordinates.sourceY + start.y;
  const endX = coordinates.targetX + end.x;
  const endY = coordinates.targetY + end.y;
  return `M ${startX},${startY} ${path.replace(/^\s*M\s*/, "L ")} L ${endX},${endY}`;
};

const resolveEdgeAppearance = (data: TypedEdgeData | undefined, selected: boolean | undefined) => {
  const color = data?.error ? "var(--data-neg)" : getPortTypeColorVar(data?.dataType);
  const emphasized = Boolean(data?.active || data?.error || selected);
  return {
    color,
    emphasized,
    lit: emphasized || Boolean(data?.visited),
    travelMs: data?.travelMs ?? 700,
  };
};

/**
 * Orthogonal step edge colored by the data type it carries -- the same color
 * language as the port dots -- with an optional animated payload dot for
 * trace playback. Used by both the editor canvas and the read-only player.
 */
export function TypedEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TypedEdgeType>) {
  const coordinates = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };
  const route = usePipelineEdgeRoute({ id, source, target, data, ...coordinates });
  const path = resolveEdgePath(route, coordinates);
  // Theme-aware color via CSS var; applied through `style` (var() is invalid in
  // SVG presentation attributes like fill=/stroke=, valid only in inline style).
  const { color, emphasized, lit, travelMs } = resolveEdgeAppearance(data, selected);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: emphasized ? 2.5 : 1.5,
          opacity: lit ? 0.95 : 0.45,
          transition: "stroke-width 150ms ease, opacity 200ms ease",
        }}
      />
      {data?.traveling ? (
        <g>
          <circle r={9} style={{ fill: color }} opacity={0.25}>
            <animateMotion
              dur={`${travelMs}ms`}
              fill="freeze"
              path={buildDotPath(path, coordinates)}
            />
          </circle>
          <circle r={4.5} strokeWidth={1} style={{ fill: color, stroke: "var(--canvas)" }}>
            <animateMotion
              dur={`${travelMs}ms`}
              fill="freeze"
              path={buildDotPath(path, coordinates)}
            />
          </circle>
        </g>
      ) : null}
    </>
  );
}

export const pipelineEdgeTypes = {
  typed: TypedEdge,
};
