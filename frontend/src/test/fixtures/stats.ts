import type {
  CollectionStatsHistory,
  CollectionStatsHistoryPoint,
  LatencySummary,
  ToolLatencySeries,
} from "@/lib/types";

export const SEARCH_TOOL_KEY = "11111111-1111-1111-1111-111111111111";

export function makeLatencySummary(overrides: Partial<LatencySummary> = {}): LatencySummary {
  return {
    count: 4,
    avg_ms: 40,
    p50_ms: 38,
    p95_ms: 60,
    p99_ms: 62,
    max_ms: 62,
    ...overrides,
  };
}

export function makeToolSeries(overrides: Partial<ToolLatencySeries> = {}): ToolLatencySeries {
  return {
    key: SEARCH_TOOL_KEY,
    pipeline_id: SEARCH_TOOL_KEY,
    name: "Search",
    summary: makeLatencySummary(),
    ...overrides,
  };
}

export function makeStatsHistoryPoint(
  overrides: Partial<CollectionStatsHistoryPoint> = {},
): CollectionStatsHistoryPoint {
  return {
    bucket_start: "2024-01-01T00:00:00Z",
    document_total: 3,
    chunk_total: 12,
    ingestion: { count: 1, avg_ms: 900, p50_ms: 900, p95_ms: 900, max_ms: 900 },
    tools: {
      [SEARCH_TOOL_KEY]: { count: 2, avg_ms: 40, p50_ms: 38, p95_ms: 60, max_ms: 62 },
    },
    ...overrides,
  };
}

export function makeStatsHistory(
  overrides: Partial<CollectionStatsHistory> = {},
): CollectionStatsHistory {
  return {
    collection_id: "col-1",
    start: "2024-01-01T00:00:00Z",
    end: "2024-01-03T00:00:00Z",
    bucket_seconds: 86400,
    points: [
      makeStatsHistoryPoint(),
      makeStatsHistoryPoint({
        bucket_start: "2024-01-02T00:00:00Z",
        document_total: 4,
        chunk_total: 16,
      }),
    ],
    tools: [makeToolSeries()],
    ingestion_summary: makeLatencySummary({ count: 2, avg_ms: 900 }),
    markers: [],
    ...overrides,
  };
}
