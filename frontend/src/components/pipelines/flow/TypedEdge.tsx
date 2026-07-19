"use client";

import { BaseEdge, getSmoothStepPath, Position } from "@xyflow/react";

import { getPortTypeColorVar } from "../lib/pipeline-theme";

import { usePipelineEdgeRoute } from "./PipelineEdgeRoutingProvider";

import type { Edge, EdgeProps } from "@xyflow/react";

export { PIPELINE_EDGE_ROUTING_OPTIONS } from "./PipelineEdgeRoutingProvider";

export type TypedEdgeData = {
  /** Port data type leaving the source handle; colors the wire. */
  dataType?: string;
  /** Trace playback: this edge is the one the flow is crossing right now. */
  active?: boolean;
  /** Trace playback: run the flow comet along the path (implies active). */
  traveling?: boolean;
  /** Duration of one comet crossing, in ms. */
  travelMs?: number;
  /** Playback edges already crossed stay softly lit. */
  visited?: boolean;
  /** Focused trace journey treatment; absent outside result focus mode. */
  itemFocus?: "traveled" | "absent";
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
 * The flow comet's motion path. React Flow anchors edges at the handle's
 * outer edge while the visible port dot is centered one handle-radius
 * inward — a comet ending at the raw path end stops visibly short of the
 * port dot, so the travel path is extended to both handle centers.
 */
const buildCometPath = (path: string, coordinates: EdgeCoordinates) => {
  const start = towardHandleCenter(coordinates.sourcePosition);
  const end = towardHandleCenter(coordinates.targetPosition);
  const startX = coordinates.sourceX + start.x;
  const startY = coordinates.sourceY + start.y;
  const endX = coordinates.targetX + end.x;
  const endY = coordinates.targetY + end.y;
  return `M ${startX},${startY} ${path.replace(/^\s*M\s*/, "L ")} L ${endX},${endY}`;
};

const resolveEdgeAppearance = (data: TypedEdgeData | undefined, selected: boolean | undefined) => {
  const color = data?.error
    ? "var(--data-neg)"
    : data?.itemFocus === "traveled"
      ? "var(--accent-cyan)"
      : getPortTypeColorVar(data?.dataType);
  const emphasized = Boolean(
    data?.active || data?.error || data?.itemFocus === "traveled" || selected,
  );
  return {
    color,
    emphasized,
    lit: emphasized || Boolean(data?.visited),
    dimmed: data?.itemFocus === "absent",
    travelMs: data?.travelMs ?? 700,
  };
};

/**
 * Orthogonal step edge colored by the data type it carries -- the same color
 * language as the port dots -- with an animated flow comet (a light segment
 * riding the wire, globals.css `pipeline-edge-comet`) for trace playback.
 * Used by both the editor canvas and the read-only player.
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
  const { color, emphasized, lit, dimmed, travelMs } = resolveEdgeAppearance(data, selected);
  const cometPath = data?.traveling ? buildCometPath(path, coordinates) : null;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: color,
          strokeWidth: emphasized ? 2.5 : 1.5,
          opacity: dimmed ? 0.15 : lit ? 0.95 : 0.45,
          transition: "stroke-width 150ms ease, opacity 200ms ease",
        }}
      />
      {cometPath !== null ? (
        // Hidden under reduced motion: the emphasized base edge above then
        // carries the crossing indication on its own.
        <g aria-hidden className="motion-reduce:hidden">
          <g opacity={0.35}>
            <path
              className="pipeline-edge-comet"
              d={cometPath}
              pathLength={1}
              fill="none"
              strokeLinecap="round"
              strokeWidth={7}
              style={{ stroke: color, animationDuration: `${travelMs}ms` }}
            />
          </g>
          <path
            className="pipeline-edge-comet"
            d={cometPath}
            pathLength={1}
            fill="none"
            strokeLinecap="round"
            strokeWidth={3}
            style={{
              // A whitened core reads as light moving over the lit wire
              // instead of a second stroke of the same color.
              stroke: `color-mix(in srgb, ${color} 55%, white)`,
              animationDuration: `${travelMs}ms`,
            }}
          />
        </g>
      ) : null}
    </>
  );
}

export const pipelineEdgeTypes = {
  typed: TypedEdge,
};
