"use client";

import {
  COORDINATE_SYSTEM,
  OrthographicView,
  type PickingInfo,
  type OrthographicViewState,
  type ViewStateChangeParameters,
} from "@deck.gl/core";
import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { CanvasContext } from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";
import { Home, LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UmapPoint } from "@/lib/types";

type UmapCanvasProps = {
  points: UmapPoint[];
  selectedPointId?: string | null;
  selectedPoint?: UmapPoint | null;
  onSelectPoint: (point: UmapPoint) => void;
};

const VIEW = new OrthographicView({ id: "umap", controller: true });

const GRID_PIXEL_STEP = 40;
const GRID_MARGIN_MULTIPLIER = 0.2;
const MIN_POINT_RADIUS_PX = 4;
const MAX_POINT_RADIUS_PX = 10;
const DEFAULT_LIMIT_FALLBACK = 4096;

// Guard against ResizeObserver running before the WebGL device limits are ready.
const ensureCanvasContextLimits = (() => {
  let patched = false;
  return () => {
    if (patched) {
      return;
    }
    patched = true;
    const original = CanvasContext.prototype.getMaxDrawingBufferSize;
    CanvasContext.prototype.getMaxDrawingBufferSize = function getMaxDrawingBufferSizePatched() {
      const maxTextureDimension = this.device?.limits?.maxTextureDimension2D;
      if (Number.isFinite(maxTextureDimension) && maxTextureDimension > 0) {
        return original.call(this);
      }
      const fallback = Math.max(
        this.canvas?.width ?? 1,
        this.canvas?.height ?? 1,
        DEFAULT_LIMIT_FALLBACK,
      );
      return [fallback, fallback];
    };
  };
})();

function buildInitialViewState(points: UmapPoint[]): OrthographicViewState {
  if (points.length === 0) {
    return { target: [0, 0, 0], zoom: 0 };
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const range = Math.max(maxX - minX, maxY - minY, 1);
  const zoom = Math.log2(400 / range);
  const clampedZoom = Math.max(-5, Math.min(12, zoom));
  return { target: [centerX, centerY, 0], zoom: clampedZoom };
}

function computeGridStep(rawStep: number) {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }
  const exponent = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, exponent);
  const fraction = rawStep / base;
  if (fraction < 1.5) return base;
  if (fraction < 3) return 2 * base;
  if (fraction < 7) return 5 * base;
  return 10 * base;
}

type GridLine = { source: [number, number]; target: [number, number] };

function computeMinimumSpacing(points: UmapPoint[], fallbackSpacing: number) {
  if (points.length < 2) {
    return fallbackSpacing;
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  });
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const span = Math.max(spanX, spanY, 1);
  const meanSpacing = span / Math.sqrt(points.length);
  const cellSize = Math.max(meanSpacing, 1e-6);
  const cellMap = new Map<string, number[]>();
  points.forEach((point, index) => {
    const cellX = Math.floor((point.x - minX) / cellSize);
    const cellY = Math.floor((point.y - minY) / cellSize);
    const key = `${cellX},${cellY}`;
    const bucket = cellMap.get(key) ?? [];
    bucket.push(index);
    cellMap.set(key, bucket);
  });
  let minimumSpacing = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const cellX = Math.floor((point.x - minX) / cellSize);
    const cellY = Math.floor((point.y - minY) / cellSize);
    let closest = Number.POSITIVE_INFINITY;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const key = `${cellX + offsetX},${cellY + offsetY}`;
        const bucket = cellMap.get(key);
        if (!bucket) {
          continue;
        }
        bucket.forEach((candidateIndex) => {
          if (candidateIndex === index) {
            return;
          }
          const candidate = points[candidateIndex];
          const dx = point.x - candidate.x;
          const dy = point.y - candidate.y;
          const distance = Math.hypot(dx, dy);
          if (distance > 0 && distance < closest) {
            closest = distance;
          }
        });
      }
    }
    const resolvedSpacing = Number.isFinite(closest) ? closest : meanSpacing;
    if (resolvedSpacing < minimumSpacing) {
      minimumSpacing = resolvedSpacing;
    }
  });
  /* c8 ignore start -- defensive fallback for non-finite point spacing */
  if (!Number.isFinite(minimumSpacing)) {
    return fallbackSpacing;
  }
  /* c8 ignore stop */
  return Math.min(minimumSpacing, fallbackSpacing);
}

export function UmapCanvas({
  points,
  selectedPointId,
  selectedPoint,
  onSelectPoint,
}: UmapCanvasProps) {
  ensureCanvasContextLimits();
  const initialViewState = useMemo(() => buildInitialViewState(points), [points]);
  const [viewState, setViewState] = useState<OrthographicViewState>(initialViewState);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const viewBounds = useMemo(() => {
    if (!containerSize.width || !containerSize.height) {
      return null;
    }
    const zoom = viewState.zoom ?? 0;
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

  useEffect(() => {
    const element = containerRef.current;
    /* c8 ignore start -- containerRef is always set in render */
    if (!element) {
      return;
    }
    /* c8 ignore stop */
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      setContainerSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gridLines = useMemo(() => {
    if (!containerSize.width || !containerSize.height) {
      return [];
    }
    const zoom = viewState.zoom ?? 0;
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
      lines.push({
        source: [x, startY],
        target: [x, endY],
      });
    }
    for (let y = startY; y <= endY; y += worldStep) {
      lines.push({
        source: [startX, y],
        target: [endX, y],
      });
    }
    return lines;
  }, [containerSize, viewState]);

  const handleViewStateChange = useCallback(
    (params: ViewStateChangeParameters<OrthographicViewState>) => {
      setViewState(params.viewState as OrthographicViewState);
    },
    [],
  );

  const handleZoom = useCallback((delta: number) => {
    setViewState((previous) => ({
      ...previous,
      zoom: Math.max(-10, Math.min(14, previous.zoom + delta)),
    }));
  }, []);

  const handleResetView = useCallback(() => {
    setViewState(initialViewState);
  }, [initialViewState]);

  const handleCenterOnSelection = useCallback(() => {
    /* c8 ignore start -- button is disabled when selection is missing */
    if (!selectedPoint) {
      return;
    }
    /* c8 ignore stop */
    setViewState((previous) => ({
      ...previous,
      target: [selectedPoint.x, selectedPoint.y, 0],
    }));
  }, [selectedPoint]);

  const layers = useMemo(() => {
    return [
      new LineLayer<GridLine>({
        id: "umap-grid",
        data: gridLines,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getSourcePosition: (line) => line.source,
        getTargetPosition: (line) => line.target,
        getColor: [148, 163, 184, 90],
        getWidth: 1,
        widthUnits: "pixels",
        parameters: { depthTest: false },
      }),
      new ScatterplotLayer<UmapPoint>({
        id: "umap-points",
        data: points,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: "pixels",
        radiusScale: 1,
        radiusMinPixels: MIN_POINT_RADIUS_PX,
        radiusMaxPixels: MAX_POINT_RADIUS_PX,
        getPosition: (point) => [point.x, point.y],
        getRadius: () => baseRadius,
        getFillColor: (point) =>
          point.id === selectedPointId ? [248, 113, 113, 220] : [129, 140, 248, 200],
        updateTriggers: {
          getFillColor: selectedPointId,
          getRadius: baseRadius,
        },
        onClick: (info: PickingInfo<UmapPoint>) => {
          if (info.object) {
            onSelectPoint(info.object);
          }
        },
      }),
    ];
  }, [baseRadius, gridLines, onSelectPoint, points, selectedPointId]);

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      <DeckGL
        views={VIEW}
        controller
        deviceProps={{ type: "webgl", adapters: [webgl2Adapter] }}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        getTooltip={(info) =>
          info.object
            ? {
                text: `Chunk ${info.object.chunk_index}`,
              }
            : null
        }
        style={{ position: "absolute", inset: 0 }}
      />
      <div className="absolute bottom-4 left-4 z-10 flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 text-slate-200">
        <button
          type="button"
          title="Zoom in"
          onClick={() => handleZoom(0.4)}
          className="flex h-10 w-10 items-center justify-center border-b border-white/10 transition hover:bg-white/10"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => handleZoom(-0.4)}
          className="flex h-10 w-10 items-center justify-center border-b border-white/10 transition hover:bg-white/10"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Center on selection"
          onClick={handleCenterOnSelection}
          disabled={!selectedPoint}
          className="flex h-10 w-10 items-center justify-center border-b border-white/10 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:text-slate-500"
        >
          <LocateFixed className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Reset view"
          onClick={handleResetView}
          className="flex h-10 w-10 items-center justify-center transition hover:bg-white/10"
        >
          <Home className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
