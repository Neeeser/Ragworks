import { TIMESTAMP } from "./files";

import type { InsightMap, InsightPoint, InsightSnapshot } from "@/lib/types";

export function makeInsightSnapshot(overrides: Partial<InsightSnapshot> = {}): InsightSnapshot {
  return {
    id: "snap-1",
    collection_id: "col-1",
    space: "semantic",
    space_label: "embed-1",
    status: "ready",
    error_message: null,
    point_count: 1,
    document_count: 1,
    cluster_count: 0,
    coverage: 1,
    transformed_count: 0,
    deleted_count: 0,
    fitted_count: 1,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeInsightPoint(overrides: Partial<InsightPoint> = {}): InsightPoint {
  return {
    id: "pt-1",
    chunk_id: "chunk-1",
    document_id: "doc-1",
    document_name: "Handbook.pdf",
    chunk_index: 0,
    x: 0,
    y: 0,
    cluster_index: null,
    ...overrides,
  };
}

export function makeInsightMap(overrides: Partial<InsightMap> = {}): InsightMap {
  return {
    snapshot: makeInsightSnapshot(),
    points: [makeInsightPoint()],
    documents: [
      {
        document_id: "doc-1",
        document_name: "Handbook.pdf",
        x: 0,
        y: 0,
        chunk_count: 1,
      },
    ],
    clusters: [],
    ...overrides,
  };
}
