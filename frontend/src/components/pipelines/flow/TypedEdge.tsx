"use client";

import { BaseEdge, getSmoothStepPath } from "@xyflow/react";

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
            <animateMotion dur={`${travelMs}ms`} fill="freeze" path={path} />
          </circle>
          <circle r={4.5} strokeWidth={1} style={{ fill: color, stroke: "var(--canvas)" }}>
            <animateMotion dur={`${travelMs}ms`} fill="freeze" path={path} />
          </circle>
        </g>
      ) : null}
    </>
  );
}

export const pipelineEdgeTypes = {
  typed: TypedEdge,
};
