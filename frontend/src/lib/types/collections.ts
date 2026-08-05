import type { UsageBreakdown } from "@/lib/types/chat";
import type { IndexBackend, UUID } from "@/lib/types/common";

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type ChunkStrategy = "token" | "sentence" | "paragraph" | "semantic";

/** Identity-only tool binding embedded in collection reads (`CollectionToolBindingRead`). */
export interface CollectionToolBinding {
  id: UUID;
  pipeline_id: UUID;
  is_primary: boolean;
  enabled: boolean;
  position: number;
}

export interface Collection {
  id: UUID;
  user_id: UUID;
  name: string;
  description?: string | null;
  ingest_pipeline_id?: UUID | null;
  tools: CollectionToolBinding[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CollectionStats {
  collection_id: UUID;
  document_count: number;
  chunk_count: number;
  average_latency_ms?: number | null;
  last_used_at?: string | null;
}

export interface LatencyBucket {
  count: number;
  avg_ms?: number | null;
  p50_ms?: number | null;
  p95_ms?: number | null;
  max_ms?: number | null;
}

/** Series key for query events whose pipeline run was never recorded. */
export const UNATTRIBUTED_TOOL_KEY = "unattributed";

/**
 * Domain-wide latency aggregates. Computed server-side from raw events —
 * percentiles neither average nor max, so these can never be folded from the
 * per-bucket values on the client.
 */
export interface LatencySummary {
  count: number;
  avg_ms?: number | null;
  p50_ms?: number | null;
  p95_ms?: number | null;
  p99_ms?: number | null;
  max_ms?: number | null;
}

/** One retrieval series: a bound tool, or the unattributed remainder. */
export interface ToolLatencySeries {
  key: string;
  pipeline_id?: UUID | null;
  name: string;
  summary: LatencySummary;
}

/**
 * One measured operation, at the moment it happened. Buckets describe a
 * window; an event describes a run, so the spread a percentile summarizes
 * stays visible. `key` names a query's tool series and is absent on ingestion.
 */
export interface LatencyEvent {
  at: string;
  duration_ms: number;
  key?: string | null;
}

export type PipelineMarkerKind = "version" | "tool_added";

/**
 * A pipeline change plotted on the shared timeline. `role` picks the charts it
 * belongs to: `ingest` explains growth and ingestion latency, `tool` belongs to
 * the retrieval series named by `key`.
 */
export interface PipelineMarker {
  at: string;
  pipeline_id: UUID;
  key: string;
  role: "ingest" | "tool";
  kind: PipelineMarkerKind;
  version?: number | null;
  label: string;
}

export interface CollectionStatsHistoryPoint {
  bucket_start: string;
  document_total: number;
  chunk_total: number;
  ingestion: LatencyBucket;
  /**
   * Every query in the bucket, whichever tool served it. Measured across all
   * of them, never folded from `tools` — percentiles do not combine.
   */
  retrieval: LatencyBucket;
  /** Keyed by series key; an absent key is a gap, never a zero-latency query. */
  tools: Record<string, LatencyBucket>;
}

export interface CollectionStatsHistory {
  collection_id: UUID;
  start: string;
  end: string;
  bucket_seconds: number;
  points: CollectionStatsHistoryPoint[];
  tools: ToolLatencySeries[];
  ingestion_summary: LatencySummary;
  retrieval_summary: LatencySummary;
  markers: PipelineMarker[];
  ingestion_events: LatencyEvent[];
  query_events: LatencyEvent[];
  /** True when an event list was thinned to fit its cap; lines still cover every row. */
  events_sampled: boolean;
}

export interface CollectionCreatePayload {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ingest_pipeline_id?: UUID | null;
  /** Bound in order; the first becomes the primary search tool. */
  tool_pipeline_ids?: UUID[] | null;
}

export interface CollectionUpdatePayload {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ingest_pipeline_id?: UUID | null;
}

export interface Document {
  id: UUID;
  collection_id: UUID;
  file_id?: UUID | null;
  name: string;
  content_type: string;
  status: DocumentStatus;
  error_message?: string | null;
  warnings: string[];
  num_chunks: number;
  num_tokens: number;
  chunk_size: number;
  chunk_overlap: number;
  chunk_strategy: ChunkStrategy;
  ingestion_run_id?: UUID | null;
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: UUID;
  document_id: UUID;
  chunk_index: number;
  text: string;
  metadata: Record<string, unknown>;
  token_count: number;
  chunk_size: number;
  chunk_strategy: ChunkStrategy;
  created_at: string;
}

export interface ChunkVisualization {
  document: Document;
  chunks: Chunk[];
}

export interface ChunkDetail {
  document: Document;
  chunk: Chunk;
}

/**
 * A stored image asset a retrieval match references, as carried on chunk
 * metadata under the reserved `ragworks.image_asset` key — the mirror of
 * `MediaAsset` in `app/pipelines/payloads.py` minus its byte size.
 */
export interface MediaAssetRef {
  media_type: string;
  path: string;
  width: number | null;
  height: number | null;
}

export interface QueryChunk {
  id?: UUID;
  chunk_id?: string;
  document_id?: string;
  text?: string;
  score?: number;
  metadata?: Record<string, unknown>;
  chunk_index?: number;
  [key: string]: unknown;
}

export interface CollectionQueryRequest {
  query: string;
  top_k?: number;
  arguments?: Record<string, number | string | boolean> | null;
}

export interface CollectionQueryResult {
  query: string;
  top_k: number;
  chunks: QueryChunk[];
  usage: UsageBreakdown;
  outputs?: Record<string, number | string | boolean>;
  query_event_id?: UUID;
  pipeline_run_id?: UUID;
}

/** Mirrors `app/schemas/retrieval.py::FailedNodeRef`. */
export interface FailedNodeRef {
  node_id: string;
  node_name: string;
  node_type: string;
}

/**
 * Structured error body for a failed retrieval query.
 * Mirrors `app/schemas/retrieval.py::RetrievalFailureDetail`. Arrives on
 * `ApiError.rawDetail` (the formatted `ApiError.detail` string loses the shape).
 */
export interface RetrievalFailureDetail {
  message: string;
  code: string;
  failed_node?: FailedNodeRef | null;
  pipeline_run_id?: UUID | null;
}

/** Narrow an `ApiError.rawDetail` to a structured retrieval failure. */
export function isRetrievalFailure(detail: unknown): detail is RetrievalFailureDetail {
  return (
    typeof detail === "object" &&
    detail !== null &&
    "code" in detail &&
    (detail as { code: unknown }).code === "retrieval_pipeline_failed"
  );
}

/** Mirrors `app/schemas/retrieval.py::QueryArgumentRead`. */
export interface CollectionQueryArgument {
  name: string;
  type: "integer" | "number" | "string" | "boolean" | "enum";
  description: string;
  required: boolean;
  default: number | string | boolean | null;
  minimum: number | null;
  maximum: number | null;
  choices: string[];
  expose_to_llm: boolean;
}

export interface CollectionQueryArgumentsResponse {
  arguments: CollectionQueryArgument[];
}

/** Mirrors `app/schemas/collections.py::CollectionIndexTarget`.
 *
 * An index a bound pipeline names inside its own graph. There is nothing to
 * select — the choice belongs to the pipeline that names it — but the
 * collection still has to be able to say where its data lives.
 */
export interface CollectionIndexTarget {
  name: string;
  backend: IndexBackend;
  vector_type: string;
  dimension: number | null;
  pipelines: string[];
}

/** Mirrors `app/schemas/collections.py::CollectionIndexesRead`. */
export interface CollectionIndexesRead {
  targets: CollectionIndexTarget[];
}
