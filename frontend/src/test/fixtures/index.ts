/**
 * Shared test fixtures. Every entity has a `make*` builder that returns a fresh
 * object each call and accepts a partial override. Prefer builders over inline
 * object literals in tests so the canonical shape lives in one place.
 */
import type {
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
  IngestionResponse,
  ModelEndpointDirectory,
  ModelInfo,
  NodeSpec,
  PineconeIndex,
  Pipeline,
  PipelineNodeRunTrace,
  PipelineTraceResponse,
  PipelineValidationResult,
  PipelineVersion,
  PromptDetails,
  ToolCallTrace,
  UmapVisualization,
  User,
} from "@/lib/types";

export const TIMESTAMP = "2024-01-01T00:00:00.000Z";
export const USER_ID = "user-1";
const PROVIDER_A = "provider-a";
const CHAT_SETTINGS_TYPE = "chat.settings";
const CHAT_SETTINGS_LABEL = "Chat settings";

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: "user@example.com",
    is_active: true,
    openrouter_configured: true,
    pinecone_configured: true,
    last_used_chat_model: "model-1",
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
    ...overrides,
  };
}

export function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: "col-1",
    user_id: USER_ID,
    name: "Alpha",
    description: "Alpha collection",
    ingestion_pipeline_id: null,
    retrieval_pipeline_id: "pipe-1",
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

export function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    collection_id: "col-1",
    name: "Document.pdf",
    content_type: "application/pdf",
    status: "ready",
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

export function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pipe-1",
    user_id: USER_ID,
    name: "Retrieval",
    description: null,
    kind: "retrieval",
    current_version: 1,
    is_default: false,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    definition: {
      nodes: [
        {
          id: "node-1",
          type: CHAT_SETTINGS_TYPE,
          name: CHAT_SETTINGS_LABEL,
          config: { chat_model: "model-1", context_window: 4096 },
        },
      ],
      edges: [],
    },
    ...overrides,
  };
}

export function makePipelineVersion(overrides: Partial<PipelineVersion> = {}): PipelineVersion {
  return {
    id: "ver-1",
    pipeline_id: "pipe-1",
    version: 1,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
    change_summary: null,
    created_by: USER_ID,
    ...overrides,
  };
}

export function makeNodeSpec(overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    type: CHAT_SETTINGS_TYPE,
    label: CHAT_SETTINGS_LABEL,
    category: "chat",
    description: "Configure chat model",
    example: "",
    input_ports: [{ key: "in", label: "In", data_type: "any", required: false }],
    output_ports: [{ key: "out", label: "Out", data_type: "any", required: false }],
    config_schema: {},
    default_config: {},
    ...overrides,
  };
}

export function makePineconeIndex(overrides: Partial<PineconeIndex> = {}): PineconeIndex {
  return {
    name: "index-1",
    vector_type: "dense",
    metric: "cosine",
    dimension: 1536,
    status: { ready: true, state: "Ready" },
    host: "index-1.pinecone.io",
    deletion_protection: "disabled",
    ...overrides,
  };
}

export function makeValidation(
  overrides: Partial<PipelineValidationResult> = {},
): PipelineValidationResult {
  return { valid: true, errors: [], warnings: [], ...overrides };
}

export function makeChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    user_id: USER_ID,
    title: "Chat 9:00 AM",
    mode: "chat",
    chat_model: "model-1",
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

export function makePromptDetails(overrides: Partial<PromptDetails> = {}): PromptDetails {
  return {
    template: "System prompt for {{user}}",
    rendered: "System prompt for user@example.com",
    context: { user: "user@example.com" },
    variables: [{ name: "user", description: "User email" }],
    is_custom: true,
    ...overrides,
  };
}

export function makeModelInfo(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: "model-1",
    canonical_slug: "openrouter/model-1",
    name: "Model One",
    description: "Primary model",
    supported_parameters: ["temperature", "reasoning", "tools"],
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

export function makeIngestionResponse(
  overrides: Partial<IngestionResponse> = {},
): IngestionResponse {
  return {
    document: makeDocument(),
    chunk_count: 4,
    pinecone_namespace: "col-1",
    embedding_model: "embed-1",
    usage: {},
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
    points: [{ id: "pt-1", chunk_id: "chunk-1", document_id: "doc-1", chunk_index: 0, x: 0, y: 0 }],
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
    node_type: CHAT_SETTINGS_TYPE,
    node_name: CHAT_SETTINGS_LABEL,
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
      kind: "retrieval",
      user_id: USER_ID,
      collection_id: "col-1",
      status: "completed",
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

// Rich chat-studio scenario fixtures (relocated from chat-studio/__tests__).
export * from "@/test/fixtures/chat-scenarios";
