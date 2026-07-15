import type { ModelPricing } from "@/lib/types/chat";
import type { IndexBackend, UUID } from "@/lib/types/common";

export type PipelineKind = "ingestion" | "retrieval";
export type PipelineRunStatus = "running" | "completed" | "failed";
export type PipelineIOType = "input" | "output";

export interface VectorIndex {
  name: string;
  backend: IndexBackend;
  vector_type?: string | null;
  metric?: string | null;
  dimension?: number | null;
  status?: Record<string, unknown> | null;
  host?: string | null;
  spec?: Record<string, unknown> | null;
  deletion_protection?: string | null;
  tags?: Record<string, string> | null;
}

export interface IndexCreatePayload {
  backend: IndexBackend;
  name: string;
  vector_type?: string;
  dimension?: number;
  metric?: string;
  cloud?: string;
  region?: string;
  deletion_protection?: string;
  tags?: Record<string, string>;
}

/** A backend's hard limits (`BackendCapabilitiesRead` in `app/schemas/indexes.py`). */
export interface BackendCapabilities {
  max_dimension: number;
  supported_metrics: string[];
  supported_vector_types: string[];
  index_name_max_length: number;
  max_upsert_batch: number;
  max_top_k: number;
  requires_api_key: boolean;
}

export interface BackendInfo {
  backend: IndexBackend;
  label: string;
  available: boolean;
  configured: boolean;
  /** Whether sparse (BM25) indexes work on this deployment right now. */
  lexical_available: boolean;
  capabilities: BackendCapabilities;
}

export interface EmbeddingModelInfo {
  id: string;
  name: string;
  description?: string | null;
  context_length?: number | null;
  pricing?: ModelPricing | null;
  dimension?: number | null;
}

export interface PipelineNodePosition {
  x: number;
  y: number;
}

export interface PipelineNodeDefinition {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  position?: PipelineNodePosition | null;
  ui?: Record<string, unknown>;
}

export interface PipelineEdgeDefinition {
  id: string;
  source: string;
  target: string;
  source_port?: string | null;
  target_port?: string | null;
  ui?: Record<string, unknown>;
}

export interface PipelineDefinition {
  nodes: PipelineNodeDefinition[];
  edges: PipelineEdgeDefinition[];
  viewport?: Record<string, unknown>;
}

export interface Pipeline {
  id: UUID;
  user_id: UUID;
  name: string;
  description?: string | null;
  kind: PipelineKind;
  current_version: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  definition: PipelineDefinition;
}

/** One structural change a version introduced (`PipelineChangeRead`). */
export interface PipelineChange {
  kind: string;
  summary: string;
}

export interface PipelineVersion {
  id: UUID;
  pipeline_id: UUID;
  version: number;
  created_at: string;
  updated_at: string;
  change_summary?: string | null;
  created_by?: UUID | null;
  changes: PipelineChange[];
}

export interface NodePort {
  key: string;
  label: string;
  data_type: string;
  required: boolean;
  /** Variadic input: any number of edges may target this port (fusion nodes). */
  accepts_many: boolean;
}

export interface NodeSpec {
  type: string;
  label: string;
  category: string;
  description: string;
  example: string;
  input_ports: NodePort[];
  output_ports: NodePort[];
  config_schema: Record<string, unknown>;
  default_config: Record<string, unknown>;
  hidden: boolean;
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: PipelineValidationIssue[];
}

export interface PipelineValidationIssue {
  code?: string | null;
  message: string;
  severity: "error" | "warning";
  node_id?: string | null;
  field?: string | null;
  configured_value?: string | number | boolean | null;
  model?: string | null;
  allowed_max?: number | null;
}
