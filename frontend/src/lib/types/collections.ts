import type { UsageBreakdown } from "@/lib/types/chat";
import type { UUID } from "@/lib/types/common";

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type ChunkStrategy = "token" | "sentence" | "paragraph" | "semantic";

export interface Collection {
  id: UUID;
  user_id: UUID;
  name: string;
  description?: string | null;
  ingestion_pipeline_id?: UUID | null;
  retrieval_pipeline_id?: UUID | null;
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

export interface CollectionStatsHistoryPoint {
  date: string;
  document_total: number;
  chunk_total: number;
  ingestion: LatencyBucket;
  retrieval: LatencyBucket;
}

export interface CollectionStatsHistory {
  collection_id: UUID;
  days: number;
  points: CollectionStatsHistoryPoint[];
}

export interface PromptVariable {
  name: string;
  description: string;
  example?: string | null;
}

export interface PromptDetails {
  template: string;
  rendered: string;
  context: Record<string, string>;
  variables: PromptVariable[];
  is_custom: boolean;
}

export type CollectionPromptDetails = PromptDetails;

export interface PipelineNodeOverride {
  node_id: string;
  config: Record<string, unknown>;
}

export interface CollectionPipelineOverrides {
  ingestion?: PipelineNodeOverride[];
  retrieval?: PipelineNodeOverride[];
}

export interface CollectionCreatePayload {
  name: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ingestion_pipeline_id?: UUID | null;
  retrieval_pipeline_id?: UUID | null;
  pipeline_overrides?: CollectionPipelineOverrides;
}

export interface CollectionUpdatePayload {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  ingestion_pipeline_id?: UUID | null;
  retrieval_pipeline_id?: UUID | null;
}

export interface Document {
  id: UUID;
  collection_id: UUID;
  file_id?: UUID | null;
  name: string;
  content_type: string;
  status: DocumentStatus;
  error_message?: string | null;
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

export interface UmapProjection {
  id: UUID;
  collection_id: UUID;
  embedding_model: string;
  n_neighbors: number;
  min_dist: number;
  metric: string;
  n_components: number;
  random_state: number;
  point_count: number;
  created_at: string;
  updated_at: string;
}

export interface UmapPoint {
  id: UUID;
  chunk_id: UUID;
  document_id: UUID;
  chunk_index: number;
  x: number;
  y: number;
}

export interface UmapVisualization {
  projection: UmapProjection;
  points: UmapPoint[];
}

export interface UmapComputePayload {
  n_neighbors?: number;
  min_dist?: number;
  metric?: string;
  random_state?: number;
  n_components?: number;
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

export interface CollectionQueryResult {
  query: string;
  top_k: number;
  chunks: QueryChunk[];
  usage: UsageBreakdown;
  query_event_id?: UUID;
  pipeline_run_id?: UUID;
}
