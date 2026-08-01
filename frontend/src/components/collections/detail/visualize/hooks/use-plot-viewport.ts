"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { computeGridStep, computeMinimumSpacing } from "../lib/plot-geometry";

import type { GridLine, XYPoint } from "../lib/plot-geometry";
import type { OrthographicViewState, ViewStateChangeParameters } from "@deck.gl/core";

const GRID_PIXEL_STEP = 40;
const GRID_MARGIN_MULTIPLIER = 0.2;
const MIN_POINT_RADIUS_PX = 4;
const MAX_POINT_RADIUS_PX = 10;

// Zoom is bounded around the fitted overview: two steps out keeps every
// point on screen with context, six steps in separates the densest pair —
// beyond either end there is only empty plane and a lost user.
const ZOOM_OUT_STEPS = 2;
const ZOOM_IN_STEPS = 6;

export type PlotViewport = {
  /** Callback ref for the plot's container element. */
  setContainerElement: (element: HTMLDivElement | null) => void;
  viewState: OrthographicViewState;
  setViewState: React.Dispatch<React.SetStateAction<OrthographicViewState>>;
  handleViewStateChange: (params: ViewStateChangeParameters<OrthographicViewState>) => void;
  zoomBy: (delta: number) => void;
  reset: () => void;
  centerOn: (x: number, y: number) => void;
  gridLines: GridLine[];
  /** Density-derived dot radius for the currently visible points. */
  baseRadius: number;
};

/**
 * The orthographic plot's shared chassis: view state, container size
 * observation, the adaptive grid, and the density-derived dot radius. Both
 * canvases (map and graph) sit on the same behavior so panning one feels like
 * panning the other.
 */
export function usePlotViewport(
  points: XYPoint[],
  initialViewState: OrthographicViewState,
): PlotViewport {
  const initialZoom = typeof initialViewState.zoom === "number" ? initialViewState.zoom : 0;
  const minZoom = initialZoom - ZOOM_OUT_STEPS;
  const maxZoom = initialZoom + ZOOM_IN_STEPS;
  const [viewState, setViewState] = useState<OrthographicViewState>({
    ...initialViewState,
    minZoom,
    maxZoom,
  });
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerElement) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(containerElement);
    return () => observer.disconnect();
  }, [containerElement]);

  const viewBounds = useMemo(() => {
    if (!containerSize.width || !containerSize.height) {
      return null;
    }
    const zoom = typeof viewState.zoom === "number" ? viewState.zoom : 0;
    const scale = Math.pow(2, zoom);
    const halfWidth = containerSize.width / 2 / scale;
    const halfHeight = containerSize.height / 2 / scale;
    const target = viewState.target ?? [0, 0, 0];
    const targetX = target[0] ?? 0;
    const targetY = target[1] ?? 0;
    return {
      minX: targetX - halfWidth,
      maxX: targetX + halfWidth,
      minY: targetY - halfHeight,
      maxY: targetY + halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
      scale,
    };
  }, [containerSize.height, containerSize.width, viewState]);

  const baseRadius = useMemo(() => {
    if (!viewBounds) {
      return MIN_POINT_RADIUS_PX;
    }
    const visiblePoints = points.filter(
      (point) =>
        point.x >= viewBounds.minX &&
        point.x <= viewBounds.maxX &&
        point.y >= viewBounds.minY &&
        point.y <= viewBounds.maxY,
    );
    const fallbackSpacing =
      Math.max(viewBounds.width, viewBounds.height, 1) /
      Math.sqrt(Math.max(visiblePoints.length, 1));
    const minimumSpacing = computeMinimumSpacing(visiblePoints, fallbackSpacing);
    const radiusFromSpacing = minimumSpacing * viewBounds.scale * 0.45;
    return Math.max(MIN_POINT_RADIUS_PX, Math.min(MAX_POINT_RADIUS_PX, radiusFromSpacing));
  }, [points, viewBounds]);

  const gridLines = useMemo(() => {
    if (!containerSize.width || !containerSize.height) {
      return [];
    }
    const zoom = typeof viewState.zoom === "number" ? viewState.zoom : 0;
    const scale = Math.pow(2, zoom);
    const worldStep = computeGridStep(GRID_PIXEL_STEP / scale);
    const halfWidth = containerSize.width / 2 / scale;
    const halfHeight = containerSize.height / 2 / scale;
    const margin = Math.max(halfWidth, halfHeight) * GRID_MARGIN_MULTIPLIER;
    const target = viewState.target ?? [0, 0, 0];
    const targetX = target[0] ?? 0;
    const targetY = target[1] ?? 0;
    const startX = Math.floor((targetX - halfWidth - margin) / worldStep) * worldStep;
    const endX = Math.ceil((targetX + halfWidth + margin) / worldStep) * worldStep;
    const startY = Math.floor((targetY - halfHeight - margin) / worldStep) * worldStep;
    const endY = Math.ceil((targetY + halfHeight + margin) / worldStep) * worldStep;
    const lines: GridLine[] = [];
    for (let x = startX; x <= endX; x += worldStep) {
      lines.push({ source: [x, startY], target: [x, endY] });
    }
    for (let y = startY; y <= endY; y += worldStep) {
      lines.push({ source: [startX, y], target: [endX, y] });
    }
    return lines;
  }, [containerSize, viewState]);

  const handleViewStateChange = useCallback(
    (params: ViewStateChangeParameters<OrthographicViewState>) => {
      // Re-assert the bounds: the controller honors them for its own
      // gestures, but a state it emits must never drop them.
      setViewState({
        ...(params.viewState as OrthographicViewState),
        minZoom,
        maxZoom,
      });
    },
    [maxZoom, minZoom],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      setViewState((previous) => {
        const previousZoom = typeof previous.zoom === "number" ? previous.zoom : 0;
        return {
          ...previous,
          zoom: Math.max(minZoom, Math.min(maxZoom, previousZoom + delta)),
        };
      });
    },
    [maxZoom, minZoom],
  );

  const reset = useCallback(() => {
    setViewState({ ...initialViewState, minZoom, maxZoom });
  }, [initialViewState, maxZoom, minZoom]);

  const centerOn = useCallback((x: number, y: number) => {
    setViewState((previous) => ({ ...previous, target: [x, y, 0] }));
  }, []);

  return {
    setContainerElement,
    viewState,
    setViewState,
    handleViewStateChange,
    zoomBy,
    reset,
    centerOn,
    gridLines,
    baseRadius,
  };
}
