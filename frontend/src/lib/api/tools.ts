import { apiFetch } from "@/lib/api/client";

import type { UUID } from "@/lib/types/common";
import type {
  CollectionTool,
  CollectionToolCreatePayload,
  CollectionToolsResponse,
  CollectionToolUpdatePayload,
  ToolInvocationResponse,
  ToolInvokeRequest,
} from "@/lib/types/tools";

export async function listCollectionTools(
  token: string,
  collectionId: UUID,
): Promise<CollectionToolsResponse> {
  return apiFetch<CollectionToolsResponse>(`/api/collections/${collectionId}/tools`, {
    token,
  });
}

export async function addCollectionTool(
  token: string,
  collectionId: UUID,
  payload: CollectionToolCreatePayload,
): Promise<CollectionTool> {
  return apiFetch<CollectionTool>(`/api/collections/${collectionId}/tools`, {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updateCollectionTool(
  token: string,
  collectionId: UUID,
  bindingId: UUID,
  payload: CollectionToolUpdatePayload,
): Promise<CollectionTool> {
  return apiFetch<CollectionTool>(`/api/collections/${collectionId}/tools/${bindingId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function removeCollectionTool(
  token: string,
  collectionId: UUID,
  bindingId: UUID,
): Promise<void> {
  await apiFetch<void>(`/api/collections/${collectionId}/tools/${bindingId}`, {
    method: "DELETE",
    token,
  });
}

export async function invokeCollectionTool(
  token: string,
  collectionId: UUID,
  bindingId: UUID,
  payload: ToolInvokeRequest,
): Promise<ToolInvocationResponse> {
  return apiFetch<ToolInvocationResponse>(
    `/api/collections/${collectionId}/tools/${bindingId}/invoke`,
    { method: "POST", token, body: JSON.stringify(payload) },
  );
}
