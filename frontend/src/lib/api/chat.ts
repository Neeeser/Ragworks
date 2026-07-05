import { apiFetch, API_BASE_URL, parseError } from "@/lib/api/client";
import { isAbortError } from "@/lib/errors";

import type {
  ChatBranchPayload,
  ChatBranchResponse,
  ChatCompletionPayload,
  ChatMessage,
  ChatRequestPayload,
  ChatSession,
  ReasoningTraceSegment,
} from "@/lib/types";

const STREAMING_REQUEST_FAILED_MESSAGE = "Streaming request failed.";

export async function listChatSessions(
  token: string,
  options?: {
    collectionIds?: string[];
    includeUnassigned?: boolean;
  },
): Promise<ChatSession[]> {
  const params = new URLSearchParams();
  if (options?.collectionIds?.length) {
    options.collectionIds.forEach((collectionId) => {
      params.append("collection_ids", collectionId);
    });
  }
  if (options?.includeUnassigned) {
    params.set("include_unassigned", "true");
  }
  const query = params.toString();
  const path = query ? `/api/chat/sessions?${query}` : "/api/chat/sessions";
  return apiFetch<ChatSession[]>(path, {
    token,
  });
}

export async function getChatHistory(token: string, sessionId: string): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>(`/api/chat/sessions/${sessionId}`, { token });
}

export async function deleteChatSession(token: string, sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/chat/sessions/${sessionId}`, {
    method: "DELETE",
    token,
  });
}

export async function branchChatSession(
  token: string,
  sessionId: string,
  payload: ChatBranchPayload,
): Promise<ChatBranchResponse> {
  return apiFetch<ChatBranchResponse>(`/api/chat/sessions/${sessionId}/branch`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export async function chat(
  token: string,
  payload: ChatRequestPayload,
  signal?: AbortSignal,
): Promise<ChatCompletionPayload> {
  return apiFetch<ChatCompletionPayload>("/api/chat", {
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
      collection_id?: string;
      collection_name?: string;
    }
  | {
      type: "tool_result";
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
      response?: Record<string, unknown>;
      reasoning?: unknown;
      collection_id?: string;
      collection_name?: string;
    }
  | { type: "final"; payload: ChatCompletionPayload }
  | { type: "error"; message?: string };

/**
 * Single source of truth for the shape handed to `onToolCall` / `onToolResult`.
 * Derived from the `tool_result` variant of `ChatStreamEvent` (a superset of
 * the `tool_call` variant's fields, since both are already fully optional)
 * with the `type` discriminant stripped.
 */
export type ToolStreamEvent = Omit<Extract<ChatStreamEvent, { type: "tool_result" }>, "type">;

export async function streamChat(
  token: string,
  payload: ChatRequestPayload,
  handlers?: ChatStreamHandlers,
): Promise<ChatCompletionPayload | null> {
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
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
            collection_id: parsed.collection_id,
            collection_name: parsed.collection_name,
          });
        } else if (parsed.type === "tool_result") {
          handlers?.onToolResult?.({
            id: parsed.id,
            name: parsed.name,
            arguments: parsed.arguments,
            response: parsed.response,
            reasoning: parsed.reasoning,
            collection_id: parsed.collection_id,
            collection_name: parsed.collection_name,
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
