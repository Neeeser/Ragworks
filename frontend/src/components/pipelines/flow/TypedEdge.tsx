"use client";

import { BaseEdge, getBezierPath } from "@xyflow/react";

import { getPortTypeHex } from "../lib/pipeline-theme";

import type { Edge, EdgeProps } from "@xyflow/react";

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

/**
 * Bezier edge colored by the data type it carries -- the same color language
 * as the port dots -- with an optional animated payload dot for trace
 * playback. Used by both the editor canvas and the read-only flow player.
 */
export function TypedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<TypedEdgeType>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const color = data?.error ? "#f87171" : getPortTypeHex(data?.dataType);
  const emphasized = Boolean(data?.active || data?.error || selected);
  const lit = emphasized || Boolean(data?.visited);
  const travelMs = data?.travelMs ?? 700;

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
          <circle r={9} fill={color} opacity={0.25}>
            <animateMotion dur={`${travelMs}ms`} fill="freeze" path={path} />
          </circle>
          <circle r={4.5} fill={color} stroke="#020617" strokeWidth={1}>
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
