import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatSession,
  Collection,
  ModelEndpointDirectory,
  ModelInfo,
  Pipeline,
  PromptDetails,
  ToolCallTrace,
  User,
} from "@/lib/types";

const baseTimestamp = "2024-01-01T00:00:00.000Z";
const baseUserId = "user-1";
const providerA = "provider-a";

export const baseUser: User = {
  id: baseUserId,
  email: "user@example.com",
  is_active: true,
  openrouter_configured: true,
  pinecone_configured: true,
  last_used_chat_model: "model-1",
  last_used_parameters: {
    temperature: 0.7,
  },
  last_used_provider: {
    order: [providerA],
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
  created_at: baseTimestamp,
  updated_at: baseTimestamp,
};

export const collections: Collection[] = [
  {
    id: "col-1",
    user_id: baseUserId,
    name: "Alpha",
    description: "Alpha collection",
    ingestion_pipeline_id: null,
    retrieval_pipeline_id: "pipe-1",
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  },
  {
    id: "col-2",
    user_id: baseUserId,
    name: "Beta",
    description: "Beta collection",
    ingestion_pipeline_id: null,
    retrieval_pipeline_id: null,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  },
];

export const pipeline: Pipeline = {
  id: "pipe-1",
  user_id: baseUserId,
  name: "Retrieval",
  description: null,
  kind: "retrieval",
  current_version: 1,
  is_default: false,
  created_at: baseTimestamp,
  updated_at: baseTimestamp,
  definition: {
    nodes: [
      {
        id: "node-1",
        type: "chat.settings",
        name: "Chat settings",
        config: {
          chat_model: "model-1",
          context_window: 4096,
        },
      },
    ],
    edges: [],
  },
};

export const sessions: ChatSession[] = [
  {
    id: "session-1",
    user_id: baseUserId,
    title: "Chat 9:00 AM",
    mode: "chat",
    chat_model: "model-1",
    context_tokens: 128,
    tool_collection_ids: ["col-1"],
    parameter_overrides: {
      reasoning: "low",
      temperature: 0.5,
      logprobs: true,
      stop: "END",
      response_format: "  ",
    },
    provider_preferences: {
      order: [providerA],
      allow_fallbacks: false,
      data_collection: "deny",
      require_parameters: true,
      max_price: {
        prompt: 0.2,
      },
    },
    stream: true,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  },
  {
    id: "session-2",
    user_id: baseUserId,
    title: "Chat 10:00 AM",
    mode: "chat",
    chat_model: "model-2",
    context_tokens: 64,
    tool_collection_ids: [],
    parameter_overrides: {},
    provider_preferences: {},
    stream: false,
    created_at: baseTimestamp,
    updated_at: baseTimestamp,
  },
];

export const basePromptDetails: PromptDetails = {
  template: "System prompt for {{user}}",
  rendered: "System prompt for user@example.com",
  context: {
    user: "user@example.com",
    "datetime.iso": baseTimestamp,
  },
  variables: [{ name: "user", description: "User email" }],
  is_custom: true,
};

export const collectionPromptDetails: PromptDetails = {
  template: "Collection prompt for {{collection}}",
  rendered: "Collection prompt for Alpha",
  context: {
    collection: "Alpha",
  },
  variables: [{ name: "collection", description: "Collection name" }],
  is_custom: true,
};

export const modelCatalog: ModelInfo[] = [
  {
    id: "model-1",
    canonical_slug: "openrouter/model-1",
    name: "Model One",
    description: "Primary model",
    supported_parameters: [
      "temperature",
      "reasoning",
      "tools",
      "logprobs",
      "stop",
      "response_format",
    ],
    default_parameters: {
      temperature: 0.2,
      reasoning: {
        effort: "low",
      },
    },
  },
  {
    id: "model-2",
    canonical_slug: "openrouter/model-2",
    name: "Model Two",
    description: "Backup model",
    supported_parameters: ["temperature"],
    default_parameters: {
      temperature: 0.1,
    },
  },
];

export const providerDirectory: ModelEndpointDirectory = {
  id: "directory-1",
  name: "Provider Directory",
  description: "Directory",
  created: 0,
  endpoints: [
    {
      name: "Endpoint A",
      status: "active",
      context_length: 4096,
      pricing: {
        prompt: 0.1,
        completion: 0.2,
      },
      provider_name: providerA,
      supported_parameters: ["temperature"],
    },
  ],
};

export const chatMessages: ChatMessage[] = [
  {
    id: "msg-1",
    session_id: "session-1",
    role: "system",
    content: "System ready",
    created_at: baseTimestamp,
  },
  {
    id: "msg-2",
    session_id: "session-1",
    role: "user",
    content: "Hello",
    created_at: baseTimestamp,
  },
  {
    id: "msg-3",
    session_id: "session-1",
    role: "assistant",
    content: "Hi there",
    reasoning_trace: {
      segments: [{ type: "text", content: "Reasoning segment" }],
    },
    created_at: baseTimestamp,
  },
  {
    id: "msg-4",
    session_id: "session-1",
    role: "tool",
    content: '{"arguments": {"query": "alpha"}, "response": {"ok": true}}',
    tool_name: "collection.search",
    tool_call_id: "tool-1",
    created_at: baseTimestamp,
  },
];

export const toolTraces: ToolCallTrace[] = [
  {
    id: "tool-1",
    name: "collection.search",
    arguments: { query: "alpha" },
    response: { ok: true },
    reasoning: {
      type: "tool_call",
      content: "Tool reasoning",
    },
    collection_id: "col-1",
    collection_name: "Alpha",
  },
];

export const chatCompletionPayload: ChatCompletionPayload = {
  session: sessions[0],
  messages: [
    ...chatMessages,
    {
      id: "msg-5",
      session_id: "session-1",
      role: "assistant",
      content: "Final answer",
      created_at: baseTimestamp,
    },
  ],
  tool_traces: toolTraces,
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30,
    reasoning_tokens: 5,
    cost: 0.01,
  },
  provider: "provider-a",
  context_window: 4096,
  context_consumed: 256,
};

export const altChatCompletionPayload: ChatCompletionPayload = {
  session: {
    ...sessions[0],
    id: "session-branch",
    chat_model: "model-2",
    tool_collection_ids: ["col-2"],
  },
  messages: [
    ...chatMessages,
    {
      id: "msg-6",
      session_id: "session-branch",
      role: "assistant",
      content: "Branched response",
      created_at: baseTimestamp,
    },
  ],
  tool_traces: [],
  usage: {
    prompt_tokens: 5,
    completion_tokens: 7,
    total_tokens: 12,
    cost: 0.005,
  },
  provider: "provider-b",
  context_window: 2048,
  context_consumed: 100,
};
