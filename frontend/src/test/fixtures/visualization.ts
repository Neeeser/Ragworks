import { TIMESTAMP } from "./files";

import type { UmapPoint, UmapVisualization } from "@/lib/types";

export function makeUmapPoint(overrides: Partial<UmapPoint> = {}): UmapPoint {
  return {
    id: "pt-1",
    chunk_id: "chunk-1",
    document_id: "doc-1",
    document_name: "Handbook.pdf",
    text_snippet: "Ragworks indexes documents.",
    chunk_index: 0,
    x: 0,
    y: 0,
    ...overrides,
  };
}

export function makeUmapVisualization(
  overrides: Partial<UmapVisualization> = {},
): UmapVisualization {
  return {
    projection: {
      id: "umap-1",
      collection_id: "col-1",
      embedding_model: "embed-1",
      n_neighbors: 15,
      min_dist: 0.1,
      metric: "cosine",
      n_components: 2,
      random_state: 42,
      point_count: 1,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    },
    points: [makeUmapPoint()],
    ...overrides,
  };
}
