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
import { webgl2Adapter } from "@luma.gl/webgl";
import { Home, LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { useCssTokens } from "@/lib/use-css-tokens";
import { cn } from "@/lib/utils";

import { DocumentLegend } from "./DocumentLegend";
import { SERIES_TOKENS, buildDocumentSeries, seriesIndexByDocument } from "./lib/document-series";
import { cssColorToRgba } from "./lib/plot-colors";
import { buildInitialViewState, computeGridStep, computeMinimumSpacing } from "./lib/umap-geometry";
import { ensureCanvasContextLimits } from "./luma-patches";

import type { Rgba } from "./lib/plot-colors";
import type { GridLine } from "./lib/umap-geometry";
import type { UmapPoint } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

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

// deck.gl takes numeric channels, so the plot resolves its palette tokens to
// RGBA through useCssTokens (the sanctioned computed-style bridge, shared with
// ReactFlow's dot grid) and re-reads them on every palette change. The
// literals remain only as the deterministic first-paint fallback, before the
// mount effect resolves the real values.
const PLOT_TOKENS = ["--border-hairline", "--data-neg", ...SERIES_TOKENS] as const;
const HAIRLINE_TOKEN = 0;
const SELECTED_TOKEN = 1;
const FIRST_SERIES_TOKEN = 2;
const GRID_LINE_RGBA: Rgba = [148, 163, 184, 90];
// The dark mode's six slots, as channels. Used only for the pre-mount paint and
// in jsdom, where getComputedStyle resolves no custom properties.
const SERIES_RGBA: Rgba[] = [
  [139, 92, 246, 200],
  [14, 165, 183, 200],
  [189, 88, 107, 200],
  [174, 138, 13, 200],
  [74, 113, 10, 200],
  [17, 106, 172, 200],
];
const SELECTED_POINT_RGBA: Rgba = [248, 113, 113, 220];
const POINT_ALPHA = 200;
const SELECTED_POINT_ALPHA = 220;

// The deck.gl tooltip is rendered by the library into its own element, so its
// look travels as inline style; `var()` keeps it correct in every palette.
// This is the plot's hover layer rather than the shared `Tooltip` primitive
// because a point has no DOM node to anchor to and the box has to follow the
// cursor across the canvas — it is emphatically not a `title` attribute: it is
// themed, and it paints the moment the pointer picks a point.
const CANVAS_TOOLTIP_STYLE = {
  background: "var(--canvas-raised)",
  border: "1px solid var(--border-hairline)",
  borderRadius: "6px",
  boxShadow: "var(--elevation-2)",
  color: "var(--text-primary)",
  fontSize: "11px",
  lineHeight: "1.45",
  maxWidth: "260px",
  padding: "4px 6px",
  // The snippet is one collapsed line from the server, but the document name
  // sits on its own line above it, and long names must wrap rather than push
  // the box off the canvas.
  whiteSpace: "pre-line",
};

/**
 * What a hovered point says: which document it came from, which chunk of it,
 * and how that chunk reads. The snippet arrives already collapsed and clipped
 * from the server — a tooltip names a point, it does not read it back.
 */
function pointTooltipText(point: UmapPoint): string {
  const heading = `${point.document_name} · chunk ${point.chunk_index}`;
  return point.text_snippet ? `${heading}\n${point.text_snippet}` : heading;
}

export function UmapCanvas({
  points,
  selectedPointId,
  selectedPoint,
  onSelectPoint,
}: UmapCanvasProps) {
  ensureCanvasContextLimits();
  // Read as one array rather than destructured: useCssTokens returns state, so
  // the array's identity is stable until the palette actually changes — and
  // these memos feed the layer memo, which must not rebuild every render.
  const tokens = useCssTokens(PLOT_TOKENS);
  const gridColor = useMemo(
    () => cssColorToRgba(tokens[HAIRLINE_TOKEN] ?? "") ?? GRID_LINE_RGBA,
    [tokens],
  );
  const selectedColor = useMemo(
    () => cssColorToRgba(tokens[SELECTED_TOKEN] ?? "", SELECTED_POINT_ALPHA) ?? SELECTED_POINT_RGBA,
    [tokens],
  );
  const seriesColors = useMemo(
    () =>
      SERIES_TOKENS.map(
        (_token, index) =>
          cssColorToRgba(tokens[FIRST_SERIES_TOKEN + index] ?? "", POINT_ALPHA) ??
          SERIES_RGBA[index],
      ),
    [tokens],
  );
  const documentSeries = useMemo(() => buildDocumentSeries(points), [points]);
  const seriesSlots = useMemo(() => seriesIndexByDocument(documentSeries), [documentSeries]);
  const initialViewState = useMemo(() => buildInitialViewState(points), [points]);
  const [viewState, setViewState] = useState<OrthographicViewState>(initialViewState);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
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
    setViewState((previous) => {
      const previousZoom = typeof previous.zoom === "number" ? previous.zoom : 0;
      return {
        ...previous,
        zoom: Math.max(-10, Math.min(14, previousZoom + delta)),
      };
    });
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
        getColor: gridColor,
        getWidth: 1,
        widthUnits: "pixels",
        // `depthTest: false` (old WebGL-style parameter) is now expressed as an
        // always-passing depth comparison in luma.gl's WebGPU-style Parameters type.
        parameters: { depthCompare: "always" },
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
          point.id === selectedPointId
            ? selectedColor
            : (seriesColors[seriesSlots.get(point.document_id) ?? 0] ?? SERIES_RGBA[0]),
        updateTriggers: {
          getFillColor: [selectedPointId, selectedColor, seriesColors, seriesSlots],
          getRadius: baseRadius,
        },
        onClick: (info: PickingInfo<UmapPoint>) => {
          if (info.object) {
            onSelectPoint(info.object);
          }
        },
      }),
    ];
  }, [
    baseRadius,
    gridColor,
    gridLines,
    onSelectPoint,
    points,
    selectedColor,
    selectedPointId,
    seriesColors,
    seriesSlots,
  ]);

  const controls: Array<{
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    { icon: Plus, label: "Zoom in", onClick: () => handleZoom(0.4) },
    { icon: Minus, label: "Zoom out", onClick: () => handleZoom(-0.4) },
    {
      icon: LocateFixed,
      label: "Center on selection",
      onClick: handleCenterOnSelection,
      disabled: !selectedPoint,
    },
    { icon: Home, label: "Reset view", onClick: handleResetView },
  ];

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
                text: pointTooltipText(info.object),
                style: CANVAS_TOOLTIP_STYLE,
              }
            : null
        }
        style={{ position: "absolute", inset: "0" }}
      />
      <DocumentLegend series={documentSeries} />
      {/* Docked to the plot's inner corner, and its tooltips open toward the
          plot's interior so the card's clipped overflow never cuts them. */}
      {/* No `overflow-hidden` here: it would clip the controls' own tooltips.
          The end buttons carry the cluster's corners instead. */}
      <div
        className={cn(popoverSurfaceClass, "absolute bottom-3 left-3 z-10 flex flex-col text-body")}
      >
        {controls.map(({ icon: Icon, label, onClick, disabled }, position) => (
          <Tooltip key={label} content={label} side="right">
            <button
              type="button"
              aria-label={label}
              onClick={onClick}
              disabled={disabled}
              className={cn(
                "flex h-8 w-8 items-center justify-center transition-colors duration-80 ease-standard",
                position === 0 && "rounded-t-panel",
                position === controls.length - 1 && "rounded-b-panel",
                "hover:bg-surface-strong hover:text-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-violet",
                "disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent",
                position < controls.length - 1 && "border-b border-hairline",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
