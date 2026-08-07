import { apiFetch } from "@/lib/api/client";

import type { Collection } from "@/lib/types/collections";
import type { UUID } from "@/lib/types/common";
import type {
  CollectionPrimaryToolPayload,
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

/**
 * Point the collection's primary search tool at one pipeline.
 *
 * One call, not add-then-remove: the two bindings may never coexist when
 * both pipelines expose the same tool name, and the returned collection
 * carries the bindings that resulted.
 */
export async function setPrimaryCollectionTool(
  token: string,
  collectionId: UUID,
  pipelineId: UUID,
): Promise<Collection> {
  const payload: CollectionPrimaryToolPayload = { pipeline_id: pipelineId };
  return apiFetch<Collection>(`/api/collections/${collectionId}/tools/primary`, {
    method: "PUT",
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
