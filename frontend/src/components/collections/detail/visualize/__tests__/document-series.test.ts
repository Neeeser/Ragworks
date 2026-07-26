import { describe, expect, it } from "vitest";

import {
  SERIES_TOKENS,
  buildDocumentSeries,
  seriesIndexByDocument,
} from "@/components/collections/detail/visualize/lib/document-series";
import { makeUmapPoint } from "@/test/fixtures";

import type { UmapPoint } from "@/lib/types";

function pointsFor(documents: Array<[string, string, number]>): UmapPoint[] {
  return documents.flatMap(([documentId, name, chunks]) =>
    Array.from({ length: chunks }, (_unused, index) =>
      makeUmapPoint({
        id: `${documentId}-${index}`,
        chunk_id: `${documentId}-chunk-${index}`,
        document_id: documentId,
        document_name: name,
        chunk_index: index,
      }),
    ),
  );
}

describe("buildDocumentSeries", () => {
  it("gives each document one series slot and its own chunk count", () => {
    const series = buildDocumentSeries(
      pointsFor([
        ["doc-b", "Beta notes", 2],
        ["doc-a", "Alpha handbook", 3],
      ]),
    );

    expect(series.map((entry) => [entry.name, entry.chunkCount])).toEqual([
      ["Alpha handbook", 3],
      ["Beta notes", 2],
    ]);
    expect(new Set(series.map((entry) => entry.seriesIndex)).size).toBe(2);
  });

  it("keeps a document's colour when its points are reordered or it is renamed", () => {
    // A recompute emits points in whatever order UMAP produced them, and a
    // rename must not repaint the plane either.
    const original = buildDocumentSeries(
      pointsFor([
        ["doc-a", "Alpha", 1],
        ["doc-b", "Beta", 1],
        ["doc-c", "Gamma", 1],
      ]),
    );
    const recomputed = buildDocumentSeries(
      pointsFor([
        ["doc-c", "Gamma", 4],
        ["doc-b", "Renamed beta", 2],
        ["doc-a", "Alpha", 9],
      ]),
    );

    const slotsBefore = seriesIndexByDocument(original);
    const slotsAfter = seriesIndexByDocument(recomputed);
    for (const documentId of ["doc-a", "doc-b", "doc-c"]) {
      expect(slotsAfter.get(documentId)).toBe(slotsBefore.get(documentId));
    }
  });

  it("cycles the series slots past six documents instead of inventing hues", () => {
    const documents: Array<[string, string, number]> = Array.from(
      { length: 8 },
      (_unused, index) => [`doc-${index}`, `Document ${index}`, 1],
    );

    const slots = seriesIndexByDocument(buildDocumentSeries(pointsFor(documents)));

    expect([...slots.values()].every((slot) => slot < SERIES_TOKENS.length)).toBe(true);
    // Seven and eight wrap onto the first two slots; every document still
    // appears in its own right, which is what the legend disambiguates.
    expect(slots.get("doc-6")).toBe(slots.get("doc-0"));
    expect(slots.get("doc-7")).toBe(slots.get("doc-1"));
    expect(slots.size).toBe(8);
  });

  it("returns nothing for a projection with no points", () => {
    expect(buildDocumentSeries([])).toEqual([]);
  });
});
