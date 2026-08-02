/** Prompt library API: CRUD, versions, forks, preview, test bench. */

import { apiFetch, API_BASE_URL, parseError } from "./client";
import { readSseEvents } from "./sse";

import type {
  PromptCatalog,
  PromptContext,
  PromptCreatePayload,
  PromptDetail,
  PromptForkPayload,
  PromptRead,
  PromptRenderPayload,
  PromptTestMessage,
  PromptTestStreamEvent,
  PromptRenderResult,
  PromptTestPayload,
  PromptTestResult,
  PromptUpdatePayload,
  PromptVersionCreatePayload,
  PromptVersionRead,
} from "@/lib/types";

export async function listPrompts(token: string, context?: PromptContext): Promise<PromptRead[]> {
  const query = context ? `?context=${encodeURIComponent(context)}` : "";
  return apiFetch<PromptRead[]>(`/api/prompts${query}`, { token });
}

export async function getPrompt(token: string, promptId: string): Promise<PromptDetail> {
  return apiFetch<PromptDetail>(`/api/prompts/${promptId}`, { token });
}

export async function createPrompt(
  token: string,
  payload: PromptCreatePayload,
): Promise<PromptRead> {
  return apiFetch<PromptRead>("/api/prompts", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updatePrompt(
  token: string,
  promptId: string,
  payload: PromptUpdatePayload,
): Promise<PromptRead> {
  return apiFetch<PromptRead>(`/api/prompts/${promptId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function deletePrompt(token: string, promptId: string): Promise<void> {
  await apiFetch<void>(`/api/prompts/${promptId}`, { method: "DELETE", token });
}

export async function listPromptVersions(
  token: string,
  promptId: string,
): Promise<PromptVersionRead[]> {
  return apiFetch<PromptVersionRead[]>(`/api/prompts/${promptId}/versions`, { token });
}

export async function savePromptVersion(
  token: string,
  promptId: string,
  payload: PromptVersionCreatePayload,
): Promise<PromptVersionRead> {
  return apiFetch<PromptVersionRead>(`/api/prompts/${promptId}/versions`, {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function forkPrompt(
  token: string,
  promptId: string,
  payload: PromptForkPayload,
): Promise<PromptRead> {
  return apiFetch<PromptRead>(`/api/prompts/${promptId}/fork`, {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function listPromptCatalogs(token: string): Promise<PromptCatalog[]> {
  return apiFetch<PromptCatalog[]>("/api/prompts/catalogs", { token });
}

export async function renderPrompt(
  token: string,
  payload: PromptRenderPayload,
): Promise<PromptRenderResult> {
  return apiFetch<PromptRenderResult>("/api/prompts/render", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function testPrompt(
  token: string,
  payload: PromptTestPayload,
): Promise<PromptTestResult> {
  return apiFetch<PromptTestResult>("/api/prompts/test", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export interface PromptTestStreamHandlers {
  /** The payload actually sent, before the model answers. */
  onStart?: (start: {
    rendered: string;
    rendered_system: string | null;
    messages: PromptTestMessage[];
  }) => void;
  onToken?: (content: string) => void;
  signal?: AbortSignal;
}

/** Fold one stream event into the accumulating result. */
function applyTestEvent(
  event: PromptTestStreamEvent,
  result: PromptTestResult,
  tokens: string[],
  handlers?: PromptTestStreamHandlers,
): void {
  if (event.type === "start") {
    result.rendered = event.rendered;
    result.rendered_system = event.rendered_system ?? null;
    result.messages = event.messages;
    handlers?.onStart?.({
      rendered: result.rendered,
      rendered_system: result.rendered_system,
      messages: result.messages,
    });
  } else if (event.type === "token") {
    tokens.push(event.content);
    handlers?.onToken?.(event.content);
  } else if (event.type === "structured") {
    result.structured_output = event.structured_output;
  } else {
    throw new Error(event.message || "Test run failed.");
  }
}

/**
 * Run a test with the answer streamed back, so a slow model reads as
 * progress rather than a spinner. Returns the same result shape the
 * buffered endpoint does — the backend drains one generator for both, and
 * a structured run arrives whole because the engine produces it whole.
 */
export async function streamPromptTest(
  token: string,
  payload: PromptTestPayload,
  handlers?: PromptTestStreamHandlers,
): Promise<PromptTestResult> {
  const response = await fetch(`${API_BASE_URL}/api/prompts/test/stream`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: handlers?.signal,
  });
  if (!response.ok) {
    const errorData = await parseError(response);
    const detail = errorData?.detail || response.statusText || "Test run failed.";
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (!response.body) throw new Error("Streaming response body is not readable.");

  const result: PromptTestResult = {
    rendered: "",
    rendered_system: null,
    messages: [],
    response_text: null,
    structured_output: null,
  };
  const tokens: string[] = [];
  for await (const event of readSseEvents<PromptTestStreamEvent>(response.body)) {
    applyTestEvent(event, result, tokens, handlers);
  }
  if (result.structured_output === null) result.response_text = tokens.join("");
  return result;
}
