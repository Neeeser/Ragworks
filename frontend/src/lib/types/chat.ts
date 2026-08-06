import type { ProviderPreferences, UUID } from "@/lib/types/common";

export type ChatMode = "query" | "chat";
export type ChatRole = "system" | "user" | "assistant" | "tool" | "error";

export interface ChatSession {
  id: UUID;
  user_id: UUID;
  title: string;
  mode: ChatMode;
  chat_model: string;
  provider_connection_id?: UUID | null;
  context_tokens: number;
  tool_collection_ids: UUID[];
  parameter_overrides?: Record<string, unknown> | null;
  provider_preferences?: ProviderPreferences | null;
  stream?: boolean;
  branched_from_session_id?: UUID | null;
  branched_from_message_id?: UUID | null;
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
  /** Stored image assets the user attached to this message. */
  attachments?: ChatAttachmentRead[] | null;
  reasoning_trace?: {
    segments?: ReasoningTraceSegment[];
    [key: string]: unknown;
  } | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  usage?: UsageBreakdown | null;
  source_message_id?: UUID | null;
  created_at: string;
}

export interface ToolCallTrace {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  response?: Record<string, unknown> | null;
  reasoning?: ReasoningTraceSegment | null;
  collection_id?: string | null;
  collection_name?: string | null;
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

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Mirrors `app/schemas/models.py::ReasoningStyle`. */
export type ReasoningStyle = "none" | "block" | "include_flag";

/**
 * Mirrors `app/schemas/models.py::SamplingSupport` — when a model accepts
 * sampling knobs. Measured per model, because it does not follow the version:
 * gpt-5.4 accepts `temperature` where gpt-5.5 does not, and gpt-5 never does.
 */
export type SamplingSupport = "always" | "without_reasoning" | "never";

/**
 * Mirrors `app/schemas/models.py::ChatCapabilities` — what a model can *do*,
 * kept apart from the sampling knobs in `supported_parameters`. Capability
 * flags are only ever true when the provider said so, because a wrong guess
 * is a request the provider rejects outright rather than a knob the user can
 * clear.
 */
export interface ChatCapabilities {
  tools: boolean;
  reasoning: ReasoningStyle;
  /** Effort levels the provider publishes; empty means it names none. */
  reasoning_efforts: string[];
  sampling: SamplingSupport;
}

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
  capabilities?: ChatCapabilities;
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

/** A stored attachment on a message, mirroring `ChatAttachmentRead`. */
export interface ChatAttachmentRead {
  media_type: string;
  path: string;
  byte_size?: number | null;
  width?: number | null;
  height?: number | null;
}

/** One send-bar image, as the backend's `ChatImageAttachment` expects it. */
export interface ChatImageAttachmentPayload {
  media_type: string;
  data: string;
}

export interface ChatRequestPayload {
  content: string;
  attachments?: ChatImageAttachmentPayload[];
  session_id?: string;
  mode?: ChatMode;
  title?: string;
  edit_message_id?: string;
  chat_model?: string;
  provider_connection_id?: string;
  tool_collection_ids?: string[];
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

export interface ChatBranchPayload {
  message_id: string;
  title?: string;
}

export interface ChatBranchResponse {
  session: ChatSession;
  messages: ChatMessage[];
}
