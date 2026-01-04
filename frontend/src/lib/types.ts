"use client";

export type UUID = string;

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type ChunkStrategy = "token" | "sentence" | "paragraph" | "semantic";
export type ChatMode = "query" | "chat";
export type ChatRole = "system" | "user" | "assistant" | "tool";
export type PipelineKind = "ingestion" | "retrieval";
export type PipelineRunStatus = "running" | "completed" | "failed";
export type PipelineIOType = "input" | "output";

export interface User {
  id: UUID;
  email: string;
  full_name?: string | null;
  is_active: boolean;
  openrouter_configured: boolean;
  pinecone_configured: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderKeyStatus {
  configured: boolean;
  valid: boolean;
  message?: string | null;
}

export interface UserKeyValidation {
  openrouter: ProviderKeyStatus;
  pinecone: ProviderKeyStatus;
}

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

export interface PromptVariable {
  name: string;
  description: string;
  example?: string | null;
}

export interface CollectionPromptDetails {
  template: string;
  rendered: string;
  context: Record<string, string>;
  variables: PromptVariable[];
  is_custom: boolean;
}

export interface ModelPricing {
  prompt?: number | string | null;
  completion?: number | string | null;
  request?: number | string | null;
}

export interface ModelInfo {
  id: string;
  canonical_slug?: string | null;
  name: string;
  description?: string | null;
  context_length?: number | null;
  architecture?: Record<string, unknown>;
  pricing?: ModelPricing | null;
  supported_parameters: string[];
  default_parameters?: Record<string, unknown> | null;
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

export interface PipelineNodeOverride {
  node_id: string;
  config: Record<string, unknown>;
}

export interface CollectionPipelineOverrides {
  ingestion?: PipelineNodeOverride[];
  retrieval?: PipelineNodeOverride[];
}

export interface Document {
  id: UUID;
  collection_id: UUID;
  name: string;
  content_type: string;
  status: DocumentStatus;
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

export interface ChatSession {
  id: UUID;
  collection_id: UUID;
  user_id: UUID;
  title: string;
  mode: ChatMode;
  chat_model: string;
  context_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface ReasoningTraceSegment {
  status?: string;
  type?: string;
  text?: string;
  content?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id: UUID;
  session_id: UUID;
  role: ChatRole;
  content: string;
  model?: string | null;
  tool_name?: string | null;
  tool_payload?: Record<string, unknown> | null;
  tool_call_id?: string | null;
  reasoning_trace?: {
    segments?: ReasoningTraceSegment[];
    [key: string]: unknown;
  } | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  usage?: UsageBreakdown | null;
  created_at: string;
}

export interface ToolCallTrace {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  response?: Record<string, unknown> | null;
  reasoning?: ReasoningTraceSegment | null;
}

export interface UsageBreakdown {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  reasoning_tokens?: number;
  cost?: number;
  cost_details?: Record<string, number | undefined>;
  [key: string]: number | Record<string, number | undefined> | undefined;
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface ReasoningConfig {
  effort?: ReasoningEffort;
  interleaved_thinking?: boolean;
}

export interface ChatGenerationConfig {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tool_top_k?: number;
  max_output_tokens?: number;
  reasoning?: ReasoningConfig;
}

export type ProviderSortOption = "price" | "throughput" | "latency";

export interface ProviderMaxPrice {
  prompt?: number;
  completion?: number;
  request?: number;
  image?: number;
}

export interface ProviderPreferences {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: ProviderSortOption;
  max_price?: ProviderMaxPrice;
}

export interface ProviderEndpointPricing {
  prompt?: number | string | null;
  completion?: number | string | null;
  request?: number | string | null;
  image?: number | string | null;
  image_output?: number | string | null;
  audio?: number | string | null;
  input_audio_cache?: number | string | null;
  web_search?: number | string | null;
  internal_reasoning?: number | string | null;
  input_cache_read?: number | string | null;
  input_cache_write?: number | string | null;
  discount?: number | null;
}

export interface ProviderEndpoint {
  name: string;
  model_name?: string | null;
  provider_name?: string | null;
  context_length?: number | null;
  pricing?: ProviderEndpointPricing | null;
  tag?: string | null;
  quantization?: Record<string, unknown> | string | null;
  max_completion_tokens?: number | null;
  max_prompt_tokens?: number | null;
  supported_parameters?: string[];
  status?: string | number | null;
  uptime_last_30m?: number | null;
  supports_implicit_caching?: boolean;
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
  position?: PipelineNodePosition;
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

export interface PipelineRunTrace {
  id: UUID;
  pipeline_id: UUID;
  pipeline_version_id?: UUID | null;
  pipeline_version?: number | null;
  kind: PipelineKind;
  user_id: UUID;
  collection_id: UUID;
  status: PipelineRunStatus;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineNodeRunTrace {
  id: UUID;
  run_id: UUID;
  node_id: string;
  node_type: string;
  node_name: string;
  sequence_index: number;
  status: PipelineRunStatus;
  error_message?: string | null;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  summary: PipelineNodeSummary;
  created_at: string;
  updated_at: string;
}

export interface PipelineNodeSummaryValue {
  label: string;
  value: unknown;
  kind?: string;
}

export interface PipelineNodeSummary {
  inputs: PipelineNodeSummaryValue[];
  outputs: PipelineNodeSummaryValue[];
}

export interface PipelineNodeIOTrace {
  id: UUID;
  run_id: UUID;
  node_run_id: UUID;
  node_id: string;
  io_type: PipelineIOType;
  port: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PipelineTraceResponse {
  run: PipelineRunTrace;
  definition: PipelineDefinition;
  node_runs: PipelineNodeRunTrace[];
  node_io: PipelineNodeIOTrace[];
}

export interface PipelineVersion {
  id: UUID;
  pipeline_id: UUID;
  version: number;
  created_at: string;
  updated_at: string;
  change_summary?: string | null;
  created_by?: UUID | null;
}

export interface NodePort {
  key: string;
  label: string;
  data_type: string;
  required: boolean;
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
}

export interface PipelineValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ModelEndpointDirectory {
  id: string;
  name: string;
  description?: string | null;
  created?: number;
  architecture?: Record<string, unknown> | null;
  endpoints: ProviderEndpoint[];
}

export interface ListModelEndpointsResponse {
  data: ModelEndpointDirectory;
}

export interface ChatRequestPayload {
  content: string;
  session_id?: string;
  mode?: ChatMode;
  title?: string;
  edit_message_id?: string;
  chat_model?: string;
  generation?: ChatGenerationConfig;
  parameters?: Record<string, unknown>;
  provider?: ProviderPreferences;
  stream?: boolean;
}

export interface ChatCompletionPayload {
  session: ChatSession;
  messages: ChatMessage[];
  tool_traces: ToolCallTrace[];
  usage: UsageBreakdown;
  provider: string;
  context_window: number;
  context_consumed: number;
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

export interface IngestionResponse {
  document: Document;
  chunk_count: number;
  pinecone_namespace: string;
  embedding_model: string;
  usage: Record<string, unknown>;
}
