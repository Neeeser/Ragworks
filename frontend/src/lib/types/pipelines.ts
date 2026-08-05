import type { ModelPricing } from "@/lib/types/chat";
import type { IndexBackend, UUID } from "@/lib/types/common";

export type PipelineKind = "ingestion" | "retrieval";
export type PipelineRunStatus = "running" | "completed" | "failed";
export type PipelineIOType = "input" | "output";
export interface HuggingFaceTokenizerDownload {
  model_id: string;
  consent?: boolean;
  remember?: boolean;
}

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
  /** The registration row's id, or null when the index is unregistered. */
  index_id?: string | null;
  /** Whether a pipeline binding can select this index. */
  registered?: boolean;
  /** False for a registered index the store no longer holds. */
  exists?: boolean;
  in_use_by?: IndexUsage[];
}

/** Mirrors `app/schemas/indexes.py::IndexUsageRead` — one binding that
 * references a registered index; deletion is refused while any exist. */
export interface IndexUsage {
  collection_id: UUID;
  collection_name: string;
  pipeline_id: UUID;
  pipeline_name: string;
  role: string;
}

export interface IndexRegisterPayload {
  backend: IndexBackend;
  name: string;
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
  /** Whether the backend can count lexical matches (the count tool's data plane). */
  supports_lexical_count: boolean;
  /** Whether the backend can facet lexical matches (the facet tool's data plane). */
  supports_lexical_facet: boolean;
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
  max_input_tokens?: number | null;
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

export type VariableType = "integer" | "number" | "string" | "boolean" | "enum" | "model" | "index";

export interface ModelVariableValue {
  connection_id: string;
  model_name: string;
}

/** Mirrors `app/pipelines/expressions/values.py::IndexValue` — the registered
 * index a binding selects, dereferenced in expressions as `.backend`/`.name`. */
export interface IndexVariableValue {
  index_id: string;
  backend: IndexBackend;
  name: string;
}

export type VariableScalar = number | string | boolean;
export type VariableValue = VariableScalar | ModelVariableValue | IndexVariableValue;

export type VariableSource = "value" | "expression" | "input";

/** Mirrors `app/pipelines/variables.py::PipelineVariable`.
 *
 * `source: "input"` marks a caller-supplied variable: `value` is its default
 * (null/absent = the caller must supply one) and `expose_to_llm` publishes it
 * in the chat tool schema. `source: "binding"` marks one a collection binding
 * sets — chiefly which index the pipeline targets — where `value` is the
 * default a binding overrides. Definitions saved before `source` existed omit
 * it; the backend infers expression-vs-value.
 */
export interface PipelineVariable {
  name: string;
  type: VariableType;
  source?: VariableSource;
  description?: string;
  value?: VariableValue | null;
  expression?: string | null;
  minimum?: number | null;
  maximum?: number | null;
  choices?: string[];
  expose_to_llm?: boolean;
}

/** Mirrors `app/pipelines/variables.py::PipelineInputArgument` — the derived
 * caller-facing shape served by the query-arguments endpoint, never stored on
 * a definition. */
export interface PipelineInputArgument {
  name: string;
  type: VariableType;
  description?: string;
  required?: boolean;
  default?: VariableScalar | null;
  minimum?: number | null;
  maximum?: number | null;
  choices?: string[];
  expose_to_llm?: boolean;
}

/** Mirrors `app/pipelines/variables.py::PipelineOutputField`. */
export interface PipelineOutputField {
  name: string;
  expression: string;
}

export interface PipelineDefinition {
  nodes: PipelineNodeDefinition[];
  edges: PipelineEdgeDefinition[];
  viewport?: Record<string, unknown>;
  variables?: PipelineVariable[];
  /** Definition shape version; the backend stamps and migrates it. */
  schema_version?: number;
}

/** A pipeline's derived interface (`PipelineInterfaceRead`). */
export interface PipelineInterfaceRead {
  accepts_document: boolean;
  callable: boolean;
  tool_name?: string | null;
  tool_description?: string | null;
  output_kind?: "chunks" | "structured" | null;
  output_fields: string[];
}

export interface Pipeline {
  id: UUID;
  user_id: UUID;
  name: string;
  description?: string | null;
  /** Derived UI grouping (null when the graph is neither shape). */
  kind: PipelineKind | null;
  interface?: PipelineInterfaceRead | null;
  current_version: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  definition: PipelineDefinition;
  validation_issues?: PipelineValidationIssue[];
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
  /** Facets an `items` input requires of every inbound stream. */
  requires: string[];
  /** Content modalities an `items` input processes; empty means all of them. */
  accepts: string[];
  /** What happens to items outside `accepts`: forwarded, or dropped. */
  unaccepted: "passthrough" | "exclude";
  /** Facets an `items` output stamps onto every emitted item. */
  adds: string[];
  /** Output keeps its input's facets (intersection across edges) plus `adds`. */
  preserves: boolean;
}

/** Mirrors `app/pipelines/node.py::NodePreset` — a named seeded config. */
export interface NodePreset {
  id: string;
  label: string;
  description: string;
  config: Record<string, unknown>;
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
  /**
   * Vector-store backends this node works with; `null` for store-agnostic
   * nodes (chunkers, embedders, terminals). The node library renders it so a
   * user learns a backend-specific node is off-limits before wiring it in.
   */
  supported_backends: IndexBackend[] | null;
  /** Named starting configurations offered beside the raw node. */
  presets?: NodePreset[];
}

/** Mirrors `app/schemas/metadata_filter.py`. */
export type FilterOp = "eq" | "ne" | "in" | "nin" | "gt" | "gte" | "lt" | "lte" | "exists";

export type FilterScalar = string | number | boolean;

export interface FilterCondition {
  field: string;
  op: FilterOp;
  value?: FilterScalar | FilterScalar[] | null;
  /** Pipeline variable read at query time instead of a literal value. */
  var?: string | null;
}

export interface MetadataFilter {
  all: FilterCondition[];
}

/** Mirrors `app/pipelines/llm/config.py::OutputFieldSpec`. */
export type LlmOutputFieldType = "string" | "number" | "boolean" | "string_list";

export type LlmOutputTarget =
  | { kind: "metadata"; key: string }
  | { kind: "text"; mode: "replace" | "prepend" | "append"; separator: string }
  | { kind: "score" }
  | { kind: "items" };

export interface LlmOutputField {
  name: string;
  type: LlmOutputFieldType;
  description: string;
  target: LlmOutputTarget;
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
