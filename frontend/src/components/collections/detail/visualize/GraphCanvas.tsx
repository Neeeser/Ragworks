"use client";

import {
  COORDINATE_SYSTEM,
  OrthographicView,
  type OrthographicViewState,
  type ViewStateChangeParameters,
} from "@deck.gl/core";
import { LineLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { webgl2Adapter } from "@luma.gl/webgl";
import { useCallback, useMemo, useState } from "react";

import { useCssTokens } from "@/lib/use-css-tokens";

import { CANVAS_TOOLTIP_STYLE, cssColorToRgba } from "./lib/plot-colors";
import { buildInitialViewState } from "./lib/plot-geometry";
import { ensureCanvasContextLimits } from "./luma-patches";
import { CollisionTieMark, DocumentMark, PlotKey, TieMark } from "./PlotKey";

import type { Rgba } from "./lib/plot-colors";
import type { InsightDocEdge, InsightDocPoint } from "@/lib/types";

type GraphCanvasProps = {
  documents: InsightDocPoint[];
  edges: InsightDocEdge[];
  /** Edges below this similarity are hidden. */
  threshold: number;
  selectedDocumentId: string | null;
  /** Node click; `null` from a background click clears the selection. */
  onSelectDocument: (point: InsightDocPoint | null) => void;
};

type PositionedEdge = InsightDocEdge & {
  source: [number, number];
  target: [number, number];
};

const VIEW = new OrthographicView({ id: "insight-graph", controller: true });

const GRAPH_TOKENS = ["--accent-violet", "--data-neg", "--text-meta", "--border-hairline"] as const;
const ACCENT_RGBA: Rgba = [139, 92, 246, 220];
const NEG_RGBA: Rgba = [248, 113, 113, 230];
const LABEL_RGBA: Rgba = [148, 163, 184, 220];
const EDGE_RGBA: Rgba = [148, 163, 184, 120];

const MIN_NODE_RADIUS_PX = 6;
const MAX_NODE_RADIUS_PX = 18;

/**
 * Documents as nodes at their projected positions, joined by exact
 * centroid-similarity edges. Positions come from the same projection the map
 * shows, so the two views agree about where a document "is"; the edges add
 * what the 2D approximation cannot promise — measured similarity.
 */
export function GraphCanvas({
  documents,
  edges,
  threshold,
  selectedDocumentId,
  onSelectDocument,
}: GraphCanvasProps) {
  ensureCanvasContextLimits();
  const tokens = useCssTokens(GRAPH_TOKENS);
  const accentColor = useMemo(() => cssColorToRgba(tokens[0] ?? "", 220) ?? ACCENT_RGBA, [tokens]);
  const negColor = useMemo(() => cssColorToRgba(tokens[1] ?? "", 230) ?? NEG_RGBA, [tokens]);
  const labelColor = useMemo(() => cssColorToRgba(tokens[2] ?? "", 220) ?? LABEL_RGBA, [tokens]);
  const edgeColor = useMemo(() => cssColorToRgba(tokens[3] ?? "", 150) ?? EDGE_RGBA, [tokens]);

  const positionOf = useMemo(
    () => new Map(documents.map((doc) => [doc.document_id, [doc.x, doc.y] as [number, number]])),
    [documents],
  );
  const visibleEdges = useMemo<PositionedEdge[]>(
    () =>
      edges
        .filter((edge) => edge.similarity >= threshold)
        .flatMap((edge) => {
          const source = positionOf.get(edge.source_document_id);
          const target = positionOf.get(edge.target_document_id);
          return source && target ? [{ ...edge, source, target }] : [];
        }),
    [edges, positionOf, threshold],
  );
  const maxChunks = useMemo(
    () => Math.max(1, ...documents.map((doc) => doc.chunk_count)),
    [documents],
  );

  const initialViewState = useMemo(() => buildInitialViewState(documents), [documents]);
  const [viewState, setViewState] = useState<OrthographicViewState>(initialViewState);
  // Names label every node only while they can be read: on small corpora, or
  // once the user zooms past the overview. A hundred always-on labels
  // overprint into noise; hover tooltips carry the name meanwhile.
  const initialZoom = typeof initialViewState.zoom === "number" ? initialViewState.zoom : 0;
  const zoom = typeof viewState.zoom === "number" ? viewState.zoom : 0;
  const showLabels = documents.length <= 30 || zoom > initialZoom + 1.2;
  const handleViewStateChange = useCallback(
    (params: ViewStateChangeParameters<OrthographicViewState>) => {
      setViewState(params.viewState as OrthographicViewState);
    },
    [],
  );

  const layers = useMemo(
    () => [
      new LineLayer<PositionedEdge>({
        id: "graph-edges",
        data: visibleEdges,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getSourcePosition: (edge) => edge.source,
        getTargetPosition: (edge) => edge.target,
        // Collision edges — cross-document near-duplicate chunk pairs — are
        // the "retrieval will mix these up" signal, and carry the warning
        // tone; ordinary similarity stays neutral.
        getColor: (edge) => (edge.collision_count > 0 ? negColor : edgeColor),
        getWidth: (edge) => 1 + edge.similarity * 3,
        widthUnits: "pixels",
        parameters: { depthCompare: "always" },
        updateTriggers: { getColor: [negColor, edgeColor] },
      }),
      new ScatterplotLayer<InsightDocPoint>({
        id: "graph-nodes",
        data: documents,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusUnits: "pixels",
        stroked: true,
        lineWidthUnits: "pixels",
        getPosition: (doc) => [doc.x, doc.y],
        getRadius: (doc) =>
          MIN_NODE_RADIUS_PX +
          (MAX_NODE_RADIUS_PX - MIN_NODE_RADIUS_PX) * Math.sqrt(doc.chunk_count / maxChunks),
        getFillColor: (doc) =>
          doc.document_id === selectedDocumentId
            ? ([...accentColor.slice(0, 3), 150] as Rgba)
            : ([...accentColor.slice(0, 3), 70] as Rgba),
        getLineColor: accentColor,
        getLineWidth: (doc) => (doc.document_id === selectedDocumentId ? 2.5 : 1.5),
        onClick: (info) => {
          onSelectDocument((info.object as InsightDocPoint | undefined) ?? null);
        },
        updateTriggers: {
          getFillColor: [accentColor, selectedDocumentId],
          getLineColor: accentColor,
          getLineWidth: [selectedDocumentId],
        },
      }),
      new TextLayer<InsightDocPoint>({
        id: "graph-labels",
        data: showLabels ? documents : [],
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        getPosition: (doc) => [doc.x, doc.y],
        getText: (doc) =>
          doc.document_name.length > 24 ? `${doc.document_name.slice(0, 23)}…` : doc.document_name,
        getColor: labelColor,
        background: true,
        getBackgroundColor: [10, 12, 16, 170],
        backgroundPadding: [4, 2, 4, 2],
        getSize: 11,
        sizeUnits: "pixels",
        getPixelOffset: [0, 22],
        fontFamily: "ui-monospace, monospace",
        characterSet: "auto",
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        parameters: { depthCompare: "always" },
      }),
    ],
    [
      accentColor,
      documents,
      edgeColor,
      labelColor,
      maxChunks,
      negColor,
      onSelectDocument,
      selectedDocumentId,
      showLabels,
      visibleEdges,
    ],
  );

  return (
    <div className="relative h-full w-full">
      <DeckGL
        views={VIEW}
        controller
        deviceProps={{ type: "webgl", adapters: [webgl2Adapter] }}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        onClick={(info) => {
          if (!info.object) {
            onSelectDocument(null);
          }
        }}
        getTooltip={(info) => {
          const object = info.object as InsightDocPoint | PositionedEdge | undefined;
          if (!object) {
            return null;
          }
          if ("document_name" in object) {
            return {
              text: `${object.document_name}\n${object.chunk_count} chunks`,
              style: CANVAS_TOOLTIP_STYLE,
            };
          }
          const collisions =
            object.collision_count > 0
              ? `\n${object.collision_count} confusable chunk ${
                  object.collision_count === 1 ? "pair" : "pairs"
                }`
              : "";
          return {
            text: `similarity ${object.similarity.toFixed(3)}${collisions}`,
            style: CANVAS_TOOLTIP_STYLE,
          };
        }}
        style={{ position: "absolute", inset: "0" }}
      />
      <PlotKey
        entries={[
          { mark: <DocumentMark />, label: "Document (size = chunks)" },
          { mark: <TieMark />, label: "Similarity tie (width = strength)" },
          { mark: <CollisionTieMark />, label: "Tie with confusable chunks" },
        ]}
      />
    </div>
  );
}
