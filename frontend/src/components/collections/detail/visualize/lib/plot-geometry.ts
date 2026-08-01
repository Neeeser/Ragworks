import type { OrthographicViewState } from "@deck.gl/core";

/** Any datum with a projected position. */
export type XYPoint = { x: number; y: number };

/** A grid line in projection space, as deck.gl's `LineLayer` wants it. */
export type GridLine = { source: [number, number]; target: [number, number] };

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

function boundsOf(points: XYPoint[]): Bounds {
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
  return { minX, maxX, minY, maxY };
}

/** The view that frames every point, used on first paint and by "Reset view". */
export function buildInitialViewState(points: XYPoint[]): OrthographicViewState {
  if (points.length === 0) {
    return { target: [0, 0, 0], zoom: 0 };
  }
  const { minX, maxX, minY, maxY } = boundsOf(points);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const range = Math.max(maxX - minX, maxY - minY, 1);
  const zoom = Math.log2(400 / range);
  const clampedZoom = Math.max(-5, Math.min(12, zoom));
  return { target: [centerX, centerY, 0], zoom: clampedZoom };
}

/** Snap a raw world-space step to the nearest 1/2/5/10 decade, so gridlines land on round values. */
export function computeGridStep(rawStep: number) {
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

/**
 * The closest distance between any two visible points, bucketed into a uniform
 * grid so the scan stays linear rather than comparing every pair.
 *
 * The plot sizes its dots from this: points are drawn as large as the densest
 * neighbourhood allows without overlapping, so a sparse region reads as marks
 * and a dense one still reads as structure.
 */
export function computeMinimumSpacing(points: XYPoint[], fallbackSpacing: number) {
  if (points.length < 2) {
    return fallbackSpacing;
  }
  const { minX, maxX, minY, maxY } = boundsOf(points);
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

/** A labelled datum the decluttering pass can size a text box for. */
export type LabelledPoint = { x: number; y: number; label: string; size: number };

/**
 * Screen-space greedy decluttering: keep labels for the biggest clusters
 * first and drop any whose estimated pixel box would overprint one already
 * kept. Zooming in spreads the boxes apart, so more labels qualify — the
 * map paradigm's level-of-detail, without ever drawing text over text.
 */
export function declutterClusters<T extends LabelledPoint>(clusters: T[], zoom: number): T[] {
  const scale = Math.pow(2, zoom);
  const kept: Array<{ minX: number; maxX: number; minY: number; maxY: number }> = [];
  const visible: T[] = [];
  const ordered = [...clusters].sort((a, b) => b.size - a.size);
  for (const cluster of ordered) {
    const halfWidth = (cluster.label.length * 7.2) / 2 + 8;
    const halfHeight = 12;
    const box = {
      minX: cluster.x * scale - halfWidth,
      maxX: cluster.x * scale + halfWidth,
      minY: cluster.y * scale - halfHeight,
      maxY: cluster.y * scale + halfHeight,
    };
    const collides = kept.some(
      (other) =>
        box.minX < other.maxX &&
        box.maxX > other.minX &&
        box.minY < other.maxY &&
        box.maxY > other.minY,
    );
    if (!collides) {
      kept.push(box);
      visible.push(cluster);
    }
  }
  return visible;
}
