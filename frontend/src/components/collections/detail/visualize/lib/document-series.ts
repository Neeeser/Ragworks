/**
 * Assignment of chart series slots to the documents a projection covers.
 *
 * Pure, so the assignment's stability is unit-testable without a canvas.
 */

import type { UmapPoint } from "@/lib/types";

/**
 * The categorical chart series, in fixed order. UI accents are deliberately
 * absent: `--accent-cyan` sits outside the categorical lightness band, so beside
 * violet it out-shines its peer and two documents stop reading as equal.
 */
export const SERIES_TOKENS = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
] as const;

export type DocumentSeries = {
  documentId: string;
  name: string;
  chunkCount: number;
  /** Index into `SERIES_TOKENS`. */
  seriesIndex: number;
};

/**
 * Groups a projection's points by source document, one series slot each.
 *
 * The slot is the document's position in an **id-sorted** list, so a document
 * keeps its colour across recomputes and across a rename — ordering by name
 * would repaint the whole plane the moment a file is renamed, and ordering by
 * appearance would repaint it whenever UMAP emitted points in a new order.
 *
 * Past six documents the slots cycle rather than inventing hues: a generated
 * seventh colour would land wherever the arithmetic put it, which is how a
 * palette validated for contrast and colour-vision separation quietly stops
 * being either. Two documents sharing a colour is a real cost, and the legend
 * plus the per-point hover are what pay it — never colour alone.
 *
 * The returned order is by document name, because that is the order a reader
 * scans a legend in; it is deliberately independent of the colour assignment.
 */
export function buildDocumentSeries(points: UmapPoint[]): DocumentSeries[] {
  const counts = new Map<string, { name: string; chunkCount: number }>();
  for (const point of points) {
    const existing = counts.get(point.document_id);
    if (existing) {
      existing.chunkCount += 1;
    } else {
      counts.set(point.document_id, { name: point.document_name, chunkCount: 1 });
    }
  }

  const byId = [...counts.keys()].sort();
  const slotOf = new Map(byId.map((id, index) => [id, index % SERIES_TOKENS.length]));

  return [...counts.entries()]
    .map(([documentId, { name, chunkCount }]) => ({
      documentId,
      name,
      chunkCount,
      seriesIndex: slotOf.get(documentId) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.documentId.localeCompare(b.documentId));
}

/** Maps each document id to its series slot, for per-point colour lookup. */
export function seriesIndexByDocument(series: DocumentSeries[]): Map<string, number> {
  return new Map(series.map((entry) => [entry.documentId, entry.seriesIndex]));
}
