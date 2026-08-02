/** Prompt library API: CRUD, versions, forks, preview, test bench. */

import { apiFetch } from "./client";

import type {
  PromptCatalog,
  PromptContext,
  PromptCreatePayload,
  PromptDetail,
  PromptForkPayload,
  PromptRead,
  PromptRenderPayload,
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
