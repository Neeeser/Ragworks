import type { CollectionStatsHistory, CollectionStatsHistoryPoint } from "@/lib/types";

export function makeStatsHistoryPoint(
  overrides: Partial<CollectionStatsHistoryPoint> = {},
): CollectionStatsHistoryPoint {
  return {
    date: "2024-01-01",
    document_total: 3,
    chunk_total: 12,
    ingestion: { count: 1, avg_ms: 900, p50_ms: 900, p95_ms: 900, max_ms: 900 },
    retrieval: { count: 2, avg_ms: 40, p50_ms: 38, p95_ms: 60, max_ms: 62 },
    ...overrides,
  };
}

export function makeStatsHistory(
  overrides: Partial<CollectionStatsHistory> = {},
): CollectionStatsHistory {
  return {
    collection_id: "col-1",
    days: 2,
    points: [
      makeStatsHistoryPoint(),
      makeStatsHistoryPoint({ date: "2024-01-02", document_total: 4, chunk_total: 16 }),
    ],
    ...overrides,
  };
}
