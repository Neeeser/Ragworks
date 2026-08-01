"use client";

import { COORDINATE_SYSTEM, OrthographicView, type Layer, type PickingInfo } from "@deck.gl/core";
import { LineLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { webgl2Adapter } from "@luma.gl/webgl";
import { Home, LocateFixed, Minus, Plus } from "lucide-react";
import { useMemo } from "react";

import { popoverSurfaceClass } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { useCssTokens } from "@/lib/use-css-tokens";
import { cn } from "@/lib/utils";

import { usePlotViewport } from "./hooks/use-plot-viewport";
import { CANVAS_TOOLTIP_STYLE, cssColorToRgba, withAlpha } from "./lib/plot-colors";
import { buildInitialViewState } from "./lib/plot-geometry";
import { SERIES_TOKENS, clusterSeriesIndex } from "./lib/series-tokens";
import { ensureCanvasContextLimits } from "./luma-patches";

import type { Rgba } from "./lib/plot-colors";
import type { GridLine } from "./lib/plot-geometry";
import type {
  InsightCluster,
  InsightDocPoint,
  InsightPoint,
  InsightProbeResult,
} from "@/lib/types";
import type { LucideIcon } from "lucide-react";

type InsightMapCanvasProps = {
  points: InsightPoint[];
  documents: InsightDocPoint[];
  clusters: InsightCluster[];
  selectedPointId?: string | null;
  selectedPoint?: InsightPoint | null;
  onSelectPoint: (point: InsightPoint) => void;
  /** When set, other documents' chunks dim so one document's spread reads. */
  focusedDocumentId: string | null;
  onFocusDocument: (documentId: string | null) => void;
  probe: InsightProbeResult | null;
};

const VIEW = new OrthographicView({ id: "insight-map", controller: true });

const MIN_POINT_RADIUS_PX = 4;
const MAX_POINT_RADIUS_PX = 10;
const DOC_RADIUS_PX = 9;
const PROBE_RADIUS_PX = 8;

// deck.gl takes numeric channels, so the plot resolves its palette tokens to
// RGBA through useCssTokens (the sanctioned computed-style bridge) and
// re-reads them on every palette change. The literals remain only as the
// deterministic first-paint fallback, before the mount effect resolves the
// real values.
const PLOT_TOKENS = [
  "--border-hairline",
  "--data-neg",
  "--accent-violet",
  "--accent-cyan",
  "--text-meta",
  ...SERIES_TOKENS,
] as const;
const HAIRLINE_TOKEN = 0;
const SELECTED_TOKEN = 1;
const ACCENT_TOKEN = 2;
const CYAN_TOKEN = 3;
const LABEL_TOKEN = 4;
const FIRST_SERIES_TOKEN = 5;
const GRID_LINE_RGBA: Rgba = [148, 163, 184, 90];
// The dark mode's slots, as channels — the pre-mount paint and jsdom, where
// getComputedStyle resolves no custom properties.
const SERIES_RGBA: Rgba[] = [
  [139, 92, 246, 200],
  [14, 165, 183, 200],
  [189, 88, 107, 200],
  [174, 138, 13, 200],
  [74, 113, 10, 200],
  [17, 106, 172, 200],
];
const SELECTED_POINT_RGBA: Rgba = [248, 113, 113, 220];
const ACCENT_RGBA: Rgba = [139, 92, 246, 200];
const CYAN_RGBA: Rgba = [34, 211, 238, 230];
const LABEL_RGBA: Rgba = [148, 163, 184, 210];
const NOISE_RGBA: Rgba = [148, 163, 184, 130];
const POINT_ALPHA = 200;
const DIMMED_ALPHA = 45;
const SELECTED_POINT_ALPHA = 220;

type Hovered =
  | { kind: "chunk"; point: InsightPoint }
  | { kind: "document"; point: InsightDocPoint };

function tooltipText(hovered: Hovered): string {
  if (hovered.kind === "document") {
    return `${hovered.point.document_name}\n${hovered.point.chunk_count} chunks · click to focus`;
  }
  return `${hovered.point.document_name} · chunk ${hovered.point.chunk_index}`;
}

export function InsightMapCanvas({
  points,
  documents,
  clusters,
  selectedPointId,
  selectedPoint,
  onSelectPoint,
  focusedDocumentId,
  onFocusDocument,
  probe,
}: InsightMapCanvasProps) {
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
  const accentColor = useMemo(
    () => cssColorToRgba(tokens[ACCENT_TOKEN] ?? "", POINT_ALPHA) ?? ACCENT_RGBA,
    [tokens],
  );
  const cyanColor = useMemo(
    () => cssColorToRgba(tokens[CYAN_TOKEN] ?? "", 230) ?? CYAN_RGBA,
    [tokens],
  );
  const labelColor = useMemo(
    () => cssColorToRgba(tokens[LABEL_TOKEN] ?? "", 210) ?? LABEL_RGBA,
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
  const probeMatchIds = useMemo(
    () => new Set((probe?.matches ?? []).map((match) => match.chunk_id)),
    [probe],
  );
  const initialViewState = useMemo(() => buildInitialViewState(points), [points]);
  const {
    setContainerElement,
    viewState,
    handleViewStateChange,
    zoomBy,
    reset,
    centerOn,
    baseRadius,
    gridLines,
  } = usePlotViewport(points, initialViewState);

  const layers = useMemo(() => {
    const dimmed = (point: InsightPoint) =>
      focusedDocumentId !== null && point.document_id !== focusedDocumentId;
    const chunkFill = (point: InsightPoint): Rgba => {
      if (point.id === selectedPointId) {
        return selectedColor;
      }
      const slot = clusterSeriesIndex(point.cluster_index);
      const base = slot === null ? NOISE_RGBA : (seriesColors[slot] ?? SERIES_RGBA[0]);
      return dimmed(point) ? withAlpha(base, DIMMED_ALPHA) : base;
    };
    const result: Layer[] = [
      new LineLayer<GridLine>({
        id: "insight-grid",
        data: gridLines,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getSourcePosition: (line) => line.source,
        getTargetPosition: (line) => line.target,
        getColor: gridColor,
        getWidth: 1,
        widthUnits: "pixels",
        parameters: { depthCompare: "always" },
      }),
      new ScatterplotLayer<InsightPoint>({
        id: "insight-chunks",
        data: points,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: "pixels",
        radiusScale: 1,
        radiusMinPixels: MIN_POINT_RADIUS_PX,
        radiusMaxPixels: MAX_POINT_RADIUS_PX,
        getPosition: (point) => [point.x, point.y],
        getRadius: () => baseRadius,
        getFillColor: chunkFill,
        updateTriggers: {
          getFillColor: [selectedPointId, selectedColor, seriesColors, focusedDocumentId],
          getRadius: baseRadius,
        },
        onClick: (info: PickingInfo<InsightPoint>) => {
          if (info.object) {
            onSelectPoint(info.object);
          }
        },
      }),
      // Documents are rings, chunks are dots — the two marks must never be
      // mistaken for each other on a plane where both are points.
      new ScatterplotLayer<InsightDocPoint>({
        id: "insight-documents",
        data: documents,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: "pixels",
        filled: false,
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: (doc) => (doc.document_id === focusedDocumentId ? 3 : 1.5),
        getRadius: DOC_RADIUS_PX,
        getPosition: (doc) => [doc.x, doc.y],
        getLineColor: (doc) =>
          doc.document_id === focusedDocumentId ? withAlpha(accentColor, 255) : accentColor,
        updateTriggers: {
          getLineColor: [accentColor, focusedDocumentId],
          getLineWidth: focusedDocumentId,
        },
        onClick: (info: PickingInfo<InsightDocPoint>) => {
          if (info.object) {
            onFocusDocument(
              info.object.document_id === focusedDocumentId ? null : info.object.document_id,
            );
          }
        },
      }),
      new TextLayer<InsightCluster>({
        id: "insight-cluster-labels",
        data: clusters,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (cluster) => [cluster.x, cluster.y],
        getText: (cluster) => cluster.label,
        getColor: labelColor,
        getSize: 12,
        sizeUnits: "pixels",
        fontFamily: "ui-monospace, monospace",
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        parameters: { depthCompare: "always" },
      }),
    ];
    if (probe) {
      if (probeMatchIds.size > 0) {
        result.push(
          new ScatterplotLayer<InsightPoint>({
            id: "insight-probe-matches",
            data: points.filter((point) => probeMatchIds.has(point.chunk_id)),
            coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
            radiusUnits: "pixels",
            filled: false,
            stroked: true,
            lineWidthUnits: "pixels",
            getLineWidth: 2,
            getRadius: baseRadius + 3,
            getPosition: (point) => [point.x, point.y],
            getLineColor: cyanColor,
            updateTriggers: { getLineColor: cyanColor, getRadius: baseRadius },
          }),
        );
      }
      result.push(
        new ScatterplotLayer<InsightProbeResult>({
          id: "insight-probe-query",
          data: [probe],
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          radiusUnits: "pixels",
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 2,
          getRadius: PROBE_RADIUS_PX,
          getPosition: (result_) => [result_.x, result_.y],
          getFillColor: withAlpha(cyanColor, 90),
          getLineColor: cyanColor,
          updateTriggers: { getFillColor: cyanColor, getLineColor: cyanColor },
        }),
      );
    }
    return result;
  }, [
    accentColor,
    baseRadius,
    clusters,
    cyanColor,
    documents,
    focusedDocumentId,
    gridColor,
    gridLines,
    labelColor,
    onFocusDocument,
    onSelectPoint,
    points,
    probe,
    probeMatchIds,
    selectedColor,
    selectedPointId,
    seriesColors,
  ]);

  const controls: Array<{
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    { icon: Plus, label: "Zoom in", onClick: () => zoomBy(0.4) },
    { icon: Minus, label: "Zoom out", onClick: () => zoomBy(-0.4) },
    {
      icon: LocateFixed,
      label: "Center on selection",
      onClick: () => {
        if (selectedPoint) {
          centerOn(selectedPoint.x, selectedPoint.y);
        }
      },
      disabled: !selectedPoint,
    },
    { icon: Home, label: "Reset view", onClick: reset },
  ];

  return (
    <div className="relative h-full w-full" ref={setContainerElement}>
      <DeckGL
        views={VIEW}
        controller
        deviceProps={{ type: "webgl", adapters: [webgl2Adapter] }}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        getTooltip={(info) => {
          const object = info.object as InsightPoint | InsightDocPoint | undefined;
          if (!object) {
            return null;
          }
          const hovered: Hovered =
            "chunk_count" in object
              ? { kind: "document", point: object }
              : { kind: "chunk", point: object as InsightPoint };
          return { text: tooltipText(hovered), style: CANVAS_TOOLTIP_STYLE };
        }}
        style={{ position: "absolute", inset: "0" }}
      />
      {/* Docked to the plot's inner corner; tooltips open toward the plot's
          interior so the card's clipped overflow never cuts them. */}
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
