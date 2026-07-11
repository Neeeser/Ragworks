import { apiFetch } from "@/lib/api/client";

import type {
  ChunkDetail,
  ChunkVisualization,
  Collection,
  CollectionCreatePayload,
  CollectionPromptDetails,
  CollectionQueryResult,
  CollectionStats,
  CollectionUpdatePayload,
  Document,
  EndToEndTrace,
  PipelineTraceResponse,
  PromptDetails,
  UmapComputePayload,
  UmapVisualization,
} from "@/lib/types";

export async function fetchCollections(token: string): Promise<Collection[]> {
  return apiFetch<Collection[]>("/api/collections", { token });
}

export async function fetchCollection(token: string, collectionId: string): Promise<Collection> {
  return apiFetch<Collection>(`/api/collections/${collectionId}`, { token });
}

export async function fetchCollectionStats(token: string): Promise<CollectionStats[]> {
  return apiFetch<CollectionStats[]>("/api/collections/stats", { token });
}

export async function fetchCollectionStatsById(
  token: string,
  collectionId: string,
): Promise<CollectionStats> {
  return apiFetch<CollectionStats>(`/api/collections/${collectionId}/stats`, { token });
}

export async function getCollectionPrompt(
  token: string,
  collectionId: string,
): Promise<CollectionPromptDetails> {
  return apiFetch<CollectionPromptDetails>(`/api/collections/${collectionId}/prompt`, { token });
}

export async function getBasePrompt(token: string): Promise<PromptDetails> {
  return apiFetch<PromptDetails>("/api/chat/prompt", { token });
}

export async function updateCollectionPrompt(
  token: string,
  collectionId: string,
  template: string,
): Promise<CollectionPromptDetails> {
  return apiFetch<CollectionPromptDetails>(`/api/collections/${collectionId}/prompt`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ template }),
  });
}

export async function updateBasePrompt(token: string, template: string): Promise<PromptDetails> {
  return apiFetch<PromptDetails>("/api/chat/prompt", {
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
  token: string,
  collectionId: string,
  payload: CollectionUpdatePayload,
): Promise<Collection> {
  return apiFetch<Collection>(`/api/collections/${collectionId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function deleteCollection(
  token: string,
  collectionId: string,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/collections/${collectionId}`, {
    method: "DELETE",
    token,
  });
}

export async function fetchDocuments(token: string, collectionId: string): Promise<Document[]> {
  return apiFetch<Document[]>(`/api/collections/${collectionId}/documents`, { token });
}

export async function fetchDocumentChunks(
  token: string,
  documentId: string,
): Promise<ChunkVisualization> {
  return apiFetch<ChunkVisualization>(`/api/documents/${documentId}/chunks`, { token });
}

export async function fetchChunkDetail(token: string, chunkId: string): Promise<ChunkDetail> {
  return apiFetch<ChunkDetail>(`/api/chunks/${chunkId}`, { token });
}

export async function fetchCollectionUmap(
  token: string,
  collectionId: string,
): Promise<UmapVisualization> {
  return apiFetch<UmapVisualization>(`/api/collections/${collectionId}/visualizations/umap`, {
    token,
  });
}

export async function computeCollectionUmap(
  token: string,
  collectionId: string,
  payload: UmapComputePayload = {},
): Promise<UmapVisualization> {
  return apiFetch<UmapVisualization>(`/api/collections/${collectionId}/visualizations/umap`, {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function runCollectionQuery(
  token: string,
  collectionId: string,
  payload: { query: string; top_k?: number },
): Promise<CollectionQueryResult> {
  return apiFetch<CollectionQueryResult>(`/api/collections/${collectionId}/query`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export async function fetchPipelineRunTrace(
  token: string,
  runId: string,
): Promise<PipelineTraceResponse> {
  return apiFetch<PipelineTraceResponse>(`/api/pipeline-runs/${runId}`, { token });
}

export async function fetchDocumentTrace(
  token: string,
  documentId: string,
): Promise<PipelineTraceResponse> {
  return apiFetch<PipelineTraceResponse>(`/api/documents/${documentId}/trace`, { token });
}

export async function fetchQueryEventTrace(
  token: string,
  queryEventId: string,
): Promise<PipelineTraceResponse> {
  return apiFetch<PipelineTraceResponse>(`/api/query-events/${queryEventId}/trace`, { token });
}

export async function fetchQueryEventEndToEndTrace(
  token: string,
  queryEventId: string,
  chunkId?: string | null,
): Promise<EndToEndTrace> {
  const params = chunkId ? `?chunk_id=${encodeURIComponent(chunkId)}` : "";
  return apiFetch<EndToEndTrace>(`/api/query-events/${queryEventId}/trace/full${params}`, {
    token,
  });
}
