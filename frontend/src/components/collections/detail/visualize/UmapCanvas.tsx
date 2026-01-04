"use client";

import { COORDINATE_SYSTEM, OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useMemo } from "react";

import type { UmapPoint } from "@/lib/types";
import type { PickingInfo } from "@deck.gl/core";

type UmapCanvasProps = {
  points: UmapPoint[];
  selectedPointId?: string | null;
  onSelectPoint: (point: UmapPoint) => void;
  resetKey?: string;
};

const VIEW = new OrthographicView({ id: "umap", controller: true });

function buildInitialViewState(points: UmapPoint[]) {
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

export function UmapCanvas({ points, selectedPointId, onSelectPoint, resetKey }: UmapCanvasProps) {
  const initialViewState = useMemo(() => buildInitialViewState(points), [points]);

  const layers = useMemo(() => {
    return [
      new ScatterplotLayer<UmapPoint>({
        id: "umap-points",
        data: points,
        pickable: true,
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        radiusScale: 4,
        radiusMinPixels: 2,
        radiusMaxPixels: 8,
        getPosition: (point) => [point.x, point.y],
        getFillColor: (point) =>
          point.id === selectedPointId ? [248, 113, 113, 220] : [129, 140, 248, 200],
        onClick: (info: PickingInfo<UmapPoint>) => {
          if (info.object) {
            onSelectPoint(info.object);
          }
        },
      }),
    ];
  }, [points, onSelectPoint, selectedPointId]);

  return (
    <DeckGL
      key={resetKey}
      views={VIEW}
      controller
      initialViewState={initialViewState}
      layers={layers}
      getTooltip={(info) =>
        info.object
          ? {
              text: `Chunk ${info.object.chunk_index}`,
            }
          : null
      }
      style={{ width: "100%", height: "100%" }}
    />
  );
}
