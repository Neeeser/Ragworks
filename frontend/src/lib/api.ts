"use client";

import type {
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  Collection,
  CollectionCreatePayload,
  CollectionUpdatePayload,
  CollectionPromptDetails,
  CollectionQueryResult,
  Document,
  IngestionResponse,
  User,
  ChunkVisualization,
  ModelInfo,
  ListModelEndpointsResponse,
  ReasoningTraceSegment,
  Pipeline,
  PipelineDefinition,
  PipelineKind,
  PipelineValidationResult,
  PipelineVersion,
  NodeSpec,
} from "@/lib/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";
const STREAMING_REQUEST_FAILED_MESSAGE = "Streaming request failed.";

interface LoginResponse {
  access_token: string;
  token_type: string;
}

type FetchOptions = RequestInit & { token?: string; signal?: AbortSignal };

async function parseError(response: Response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, ...rest } = options;
  const headers = new Headers(rest.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (rest.body && !(rest.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || "Request failed";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", email);
  body.append("password", password);
  body.append("grant_type", "password");
  body.append("scope", "");
  body.append("client_id", "");
  body.append("client_secret", "");

  const response = await fetch(`${API_BASE_URL}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const data = await parseError(response);
    throw new Error(data?.detail || "Unable to sign in.");
  }

  return response.json();
}

export async function registerUser(payload: {
  email: string;
  password: string;
  full_name?: string;
}): Promise<User> {
  return apiFetch<User>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getProfile(token: string): Promise<User> {
  return apiFetch<User>("/api/auth/me", { token });
}

export async function fetchCollections(token: string): Promise<Collection[]> {
  return apiFetch<Collection[]>("/api/collections", { token });
}

export async function getCollectionPrompt(
  collectionId: string,
  token: string,
): Promise<CollectionPromptDetails> {
  return apiFetch<CollectionPromptDetails>(`/api/collections/${collectionId}/prompt`, { token });
}

export async function updateCollectionPrompt(
  collectionId: string,
  template: string,
  token: string,
): Promise<CollectionPromptDetails> {
  return apiFetch<CollectionPromptDetails>(`/api/collections/${collectionId}/prompt`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ template }),
  });
}

export async function createCollection(
  token: string,
  payload: CollectionCreatePayload,
): Promise<Collection> {
  return apiFetch<Collection>("/api/collections", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updateCollection(
  collectionId: string,
  token: string,
  payload: CollectionUpdatePayload,
): Promise<Collection> {
  return apiFetch<Collection>(`/api/collections/${collectionId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function fetchPipelines(token: string, kind?: PipelineKind): Promise<Pipeline[]> {
  const params = kind ? `?kind=${kind}` : "";
  return apiFetch<Pipeline[]>(`/api/pipelines${params}`, { token });
}

export async function fetchPipeline(pipelineId: string, token: string): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}`, { token });
}

export async function fetchPipelineNodes(token: string): Promise<NodeSpec[]> {
  const response = await apiFetch<{ nodes: NodeSpec[] }>("/api/pipelines/nodes", { token });
  return response.nodes;
}

export async function validatePipeline(
  token: string,
  definition: PipelineDefinition,
): Promise<PipelineValidationResult> {
  return apiFetch<PipelineValidationResult>("/api/pipelines/validate", {
    method: "POST",
    token,
    body: JSON.stringify(definition),
  });
}

export async function createPipeline(
  token: string,
  payload: {
    name: string;
    kind: PipelineKind;
    definition: PipelineDefinition;
    description?: string;
    change_summary?: string;
  },
): Promise<Pipeline> {
  return apiFetch<Pipeline>("/api/pipelines", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updatePipeline(
  pipelineId: string,
  token: string,
  payload: {
    name?: string;
    description?: string;
    definition?: PipelineDefinition;
    change_summary?: string;
  },
): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function deletePipeline(
  pipelineId: string,
  token: string,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/pipelines/${pipelineId}`, {
    method: "DELETE",
    token,
  });
}

export async function listPipelineVersions(
  pipelineId: string,
  token: string,
): Promise<PipelineVersion[]> {
  return apiFetch<PipelineVersion[]>(`/api/pipelines/${pipelineId}/versions`, { token });
}

export async function activatePipelineVersion(
  pipelineId: string,
  version: number,
  token: string,
): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}/activate`, {
    method: "POST",
    token,
    body: JSON.stringify({ version }),
  });
}

export async function fetchDocuments(collectionId: string, token: string): Promise<Document[]> {
  return apiFetch<Document[]>(`/api/collections/${collectionId}/documents`, { token });
}

export async function uploadDocument(
  collectionId: string,
  file: File,
  token: string,
): Promise<IngestionResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return apiFetch<IngestionResponse>(`/api/collections/${collectionId}/documents`, {
    method: "POST",
    body: formData,
    token,
  });
}

export async function fetchDocumentChunks(
  documentId: string,
  token: string,
): Promise<ChunkVisualization> {
  return apiFetch<ChunkVisualization>(`/api/documents/${documentId}/chunks`, { token });
}

export async function runCollectionQuery(
  collectionId: string,
  payload: { query: string; top_k?: number },
  token: string,
): Promise<CollectionQueryResult> {
  return apiFetch<CollectionQueryResult>(`/api/collections/${collectionId}/query`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export async function listChatSessions(
  collectionId: string,
  token: string,
): Promise<ChatSession[]> {
  return apiFetch<ChatSession[]>(`/api/collections/${collectionId}/sessions`, { token });
}

export async function getChatHistory(sessionId: string, token: string): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/api/chat/sessions/${sessionId}`, { token });
}

export async function deleteChatSession(sessionId: string, token: string): Promise<void> {
  return apiFetch<void>(`/api/chat/sessions/${sessionId}`, {
    method: "DELETE",
    token,
  });
}

export async function chatWithCollection(
  collectionId: string,
  payload: ChatRequestPayload,
  token: string,
  signal?: AbortSignal,
): Promise<ChatCompletionPayload> {
  return apiFetch<ChatCompletionPayload>(`/api/collections/${collectionId}/chat`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
    signal,
  });
}

export interface ChatStreamHandlers {
  onToken?: (token: string) => void;
  onReasoning?: (segments: ReasoningTraceSegment[]) => void;
  onToolCall?: (event: ToolStreamEvent) => void;
  onToolResult?: (event: ToolStreamEvent) => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

type ChatStreamEvent =
  | { type: "token"; content?: string }
  | { type: "reasoning"; segments?: ReasoningTraceSegment[] }
  | {
      type: "tool_call";
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      reasoning?: unknown;
    }
  | {
      type: "tool_result";
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      response?: Record<string, unknown>;
      reasoning?: unknown;
    }
  | { type: "final"; payload: ChatCompletionPayload }
  | { type: "error"; message?: string };

const isAbortError = (value: unknown): value is DOMException =>
  value instanceof DOMException && value.name === "AbortError";

export interface ToolStreamEvent {
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  response?: Record<string, unknown>;
  reasoning?: unknown;
}

export async function streamChatWithCollection(
  collectionId: string,
  payload: ChatRequestPayload,
  token: string,
  handlers?: ChatStreamHandlers,
): Promise<ChatCompletionPayload | null> {
  const response = await fetch(`${API_BASE_URL}/api/collections/${collectionId}/chat/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: handlers?.signal,
  });

  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || STREAMING_REQUEST_FAILED_MESSAGE;
    const message = typeof detail === "string" ? detail : JSON.stringify(detail);
    throw new Error(message);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Streaming response body is not readable.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatCompletionPayload | null = null;
  let emittedError = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = rawEvent
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.startsWith("data:"));
        if (!dataLine) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        const payloadStr = dataLine.slice(5).trim();
        if (!payloadStr) {
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        if (payloadStr === "[DONE]") {
          return finalPayload;
        }
        let parsed: ChatStreamEvent;
        try {
          parsed = JSON.parse(payloadStr) as ChatStreamEvent;
        } catch {
          boundary = buffer.indexOf("\n\n");
          continue;
        }
        if (parsed.type === "token" && parsed.content) {
          handlers?.onToken?.(parsed.content);
        } else if (parsed.type === "reasoning") {
          handlers?.onReasoning?.(parsed.segments ?? []);
        } else if (parsed.type === "tool_call") {
          handlers?.onToolCall?.({
            id: parsed.id,
            name: parsed.name,
            arguments: parsed.arguments,
            reasoning: parsed.reasoning,
          });
        } else if (parsed.type === "tool_result") {
          handlers?.onToolResult?.({
            id: parsed.id,
            name: parsed.name,
            arguments: parsed.arguments,
            response: parsed.response,
            reasoning: parsed.reasoning,
          });
        } else if (parsed.type === "final" && parsed.payload) {
          finalPayload = parsed.payload;
        } else if (parsed.type === "error") {
          const message =
            typeof parsed.message === "string" && parsed.message.trim()
              ? parsed.message
              : STREAMING_REQUEST_FAILED_MESSAGE;
          handlers?.onError?.(message);
          emittedError = true;
          throw new Error(message);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (!emittedError && !isAbortError(error)) {
      if (error instanceof Error) {
        handlers?.onError?.(error.message);
      } else {
        handlers?.onError?.(STREAMING_REQUEST_FAILED_MESSAGE);
      }
    }
    throw error;
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore cancellation errors
    }
  }

  return finalPayload;
}

export async function listModels(token?: string, refresh?: boolean): Promise<ModelInfo[]> {
  const query = refresh ? "?refresh=true" : "";
  const options: FetchOptions = {};
  if (token) {
    options.token = token;
  }
  return apiFetch<ModelInfo[]>(`/api/models${query}`, options);
}

export async function listModelEndpoints(
  author: string,
  slug: string,
): Promise<ListModelEndpointsResponse> {
  const encodedAuthor = encodeURIComponent(author);
  const encodedSlug = encodeURIComponent(slug);
  return apiFetch<ListModelEndpointsResponse>(
    `/api/models/${encodedAuthor}/${encodedSlug}/endpoints`,
  );
}

export { API_BASE_URL };
