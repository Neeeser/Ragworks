/**
 * Shared test fixtures. Every entity has a `make*` builder that returns a fresh
 * object each call and accepts a partial override. Prefer builders over inline
 * object literals in tests so the canonical shape lives in one place.
 */
import { RETRIEVER_LABEL, RETRIEVER_TYPE, USER_EMAIL, USER_ID } from "./constants";
import { TIMESTAMP } from "./files";

import type {
  AdminUser,
  ChatCompletionPayload,
  ChatMessage,
  ChatSession,
  Chunk,
  ChunkDetail,
  ChunkVisualization,
  Collection,
  CollectionQueryResult,
  CollectionStats,
  Document,
  ModelEndpointDirectory,
  ModelInfo,
  PipelineNodeRunTrace,
  PipelineTraceResponse,
  PromptRead,
  PromptSelection,
  ToolCallTrace,
  User,
} from "@/lib/types";

export { USER_EMAIL, USER_ID } from "./constants";
export * from "./pipelines";
export * from "./files";
export * from "./api-keys";
export * from "./visualization";

const USER_ROLE = "user";
const PROVIDER_A = "provider-a";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: USER_EMAIL,
    role: USER_ROLE,
    is_active: true,
    last_used_chat_model: "model-1",
    last_used_chat_connection_id: "conn-openrouter-1",
    last_used_parameters: { temperature: 0.7 },
    last_used_provider: {
      order: [PROVIDER_A],
      allow_fallbacks: false,
      data_collection: "allow",
    },
    last_used_stream: true,
    last_used_tool_collection_ids: ["col-1"],
    run_settings_order: [
      "systemPrompt",
      "collectionTools",
      "streaming",
      "modelRouting",
      "providerRouting",
      "vitals",
      "modelParameters",
      "usage",
    ],
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    remember_session_days: 30,
    remember_hf_tokenizer_downloads: false,
    ...overrides,
  };
}

export function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: USER_ID,
    email: USER_EMAIL,
    role: USER_ROLE,
    is_active: true,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    collection_count: 0,
    document_count: 0,
    ...overrides,
  };
}

export function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "col-1",
    user_id: USER_ID,
    name: "Alpha",
    description: "Alpha collection",
    ingest_pipeline_id: null,
    tools: [
      { id: "binding-1", pipeline_id: "pipe-1", is_primary: true, enabled: true, position: 0 },
    ],
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeCollectionStats(overrides: Partial<CollectionStats> = {}): CollectionStats {
  return {
    collection_id: "col-1",
    document_count: 3,
    chunk_count: 12,
    average_latency_ms: 42,
    last_used_at: TIMESTAMP,
    ...overrides,
  };
}

export * from "./diagnostics";
export * from "./stats";

export function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    collection_id: "col-1",
    name: "Document.pdf",
    content_type: "application/pdf",
    status: "ready",
    warnings: [],
    num_chunks: 4,
    num_tokens: 512,
    chunk_size: 512,
    chunk_overlap: 64,
    chunk_strategy: "token",
    ingestion_run_id: "run-1",
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: "chunk-1",
    document_id: "doc-1",
    chunk_index: 0,
    text: "Chunk text",
    metadata: {},
    token_count: 2,
    chunk_size: 512,
    chunk_strategy: "token",
    created_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeChunkVisualization(
  overrides: Partial<ChunkVisualization> = {},
): ChunkVisualization {
  return { document: makeDocument(), chunks: [makeChunk()], ...overrides };
}

export function makeChunkDetail(overrides: Partial<ChunkDetail> = {}): ChunkDetail {
  return { document: makeDocument(), chunk: makeChunk(), ...overrides };
}

export function makeChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    user_id: USER_ID,
    title: "Chat 9:00 AM",
    mode: "chat",
    chat_model: "model-1",
    provider_connection_id: "conn-openrouter-1",
    context_tokens: 128,
    tool_collection_ids: ["col-1"],
    parameter_overrides: {},
    provider_preferences: {},
    stream: true,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeChatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    session_id: "session-1",
    role: "assistant",
    content: "Hello",
    created_at: TIMESTAMP,
    ...overrides,
  };
}

export function makePromptRead(overrides: Partial<PromptRead> = {}): PromptRead {
  return {
    id: "prompt-1",
    name: "Base prompt",
    description: null,
    context: "chat.base",
    source: "user",
    shipped_key: null,
    current_version: 2,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makePromptSelection(overrides: Partial<PromptSelection> = {}): PromptSelection {
  return {
    reference: { prompt_id: "prompt-1", version: "latest" },
    prompt: makePromptRead(),
    body: "System prompt for {{user}}",
    rendered: "System prompt for user@example.com",
    context: { user: "user@example.com" },
    variables: [{ name: "user", description: "User email" }],
    ...overrides,
  };
}

export function makeModelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "model-1",
    canonical_slug: "openrouter/model-1",
    name: "Model One",
    description: "Primary model",
    supported_parameters: ["temperature"],
    capabilities: {
      tools: true,
      reasoning: "block",
      reasoning_efforts: ["low", "medium", "high"],
      sampling: "without_reasoning",
    },
    default_parameters: { temperature: 0.2 },
    ...overrides,
  };
}

export function makeProviderDirectory(
  overrides: Partial<ModelEndpointDirectory> = {},
): ModelEndpointDirectory {
  return {
    id: "directory-1",
    name: "Provider Directory",
    description: "Directory",
    created: 0,
    endpoints: [
      {
        name: "Endpoint A",
        status: "active",
        context_length: 4096,
        pricing: { prompt: 0.1, completion: 0.2 },
        provider_name: PROVIDER_A,
        supported_parameters: ["temperature"],
      },
    ],
    ...overrides,
  };
}

export function makeToolTrace(overrides: Partial<ToolCallTrace> = {}): ToolCallTrace {
  return {
    id: "tool-1",
    name: "collection.search",
    arguments: { query: "alpha" },
    response: { ok: true },
    reasoning: { type: "tool_call", content: "Tool reasoning" },
    collection_id: "col-1",
    collection_name: "Alpha",
    ...overrides,
  };
}

export function makeQueryResult(
  overrides: Partial<CollectionQueryResult> = {},
): CollectionQueryResult {
  return {
    query: "alpha",
    top_k: 5,
    chunks: [{ chunk_id: "chunk-1", document_id: "doc-1", text: "Chunk text", score: 0.9 }],
    usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
    query_event_id: "event-1",
    pipeline_run_id: "run-1",
    ...overrides,
  };
}

export function makeNodeRunTrace(
  overrides: Partial<PipelineNodeRunTrace> = {},
): PipelineNodeRunTrace {
  return {
    id: "node-run-1",
    run_id: "run-1",
    node_id: "node-1",
    node_type: RETRIEVER_TYPE,
    node_name: RETRIEVER_LABEL,
    sequence_index: 0,
    status: "completed",
    started_at: TIMESTAMP,
    completed_at: TIMESTAMP,
    duration_ms: 12,
    summary: { inputs: [], outputs: [] },
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeTraceResponse(
  overrides: Partial<PipelineTraceResponse> = {},
): PipelineTraceResponse {
  return {
    run: {
      id: "run-1",
      pipeline_id: "pipe-1",
      pipeline_version: 1,
      trigger: "tool",
      user_id: USER_ID,
      collection_id: "col-1",
      status: "completed",
      warnings: [],
      started_at: TIMESTAMP,
      completed_at: TIMESTAMP,
      created_at: TIMESTAMP,
      updated_at: TIMESTAMP,
    },
    definition: { nodes: [], edges: [] },
    node_runs: [makeNodeRunTrace()],
    node_io: [],
    ...overrides,
  };
}

export function makeChatCompletion(
  overrides: Partial<ChatCompletionPayload> = {},
): ChatCompletionPayload {
  return {
    session: makeChatSession(),
    messages: [makeChatMessage({ role: "user", content: "Hi" }), makeChatMessage()],
    tool_traces: [],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cost: 0.01 },
    provider: PROVIDER_A,
    context_window: 4096,
    context_consumed: 256,
    ...overrides,
  };
}

export * from "@/test/fixtures/config";

// Rich chat-studio scenario fixtures (relocated from chat-studio/__tests__).
export * from "@/test/fixtures/chat-scenarios";

export { makeBackendInfo, makePineconeBackendInfo, makeVectorIndex } from "./indexes";
export * from "./setup";

export {
  makeCatalogModel,
  makeConnection,
  makeModelCatalog,
  makeModelShortlist,
  makeShortlistEntry,
  makeProviderConfigField,
  makeProviderType,
} from "@/test/fixtures/providers";

export * from "@/test/fixtures/evals";

export * from "@/test/fixtures/tools";
