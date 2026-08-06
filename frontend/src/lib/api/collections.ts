import { apiFetch, apiFetchBlob } from "@/lib/api/client";

import type {
  ChunkDetail,
  ChunkVisualization,
  Collection,
  CollectionCreatePayload,
  CollectionIndexesRead,
  CollectionQueryArgumentsResponse,
  CollectionQueryRequest,
  CollectionQueryResult,
  CollectionStats,
  CollectionStatsHistory,
  CollectionUpdatePayload,
  Document,
  DocumentTrace,
  EndToEndTrace,
  PipelineTraceResponse,
  PromptSelection,
  PromptSelectionUpdatePayload,
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

/**
 * Bucketed activity history. Omitting the span yields the collection's whole
 * life; passing one narrows to it. The server picks the bucket width either
 * way and echoes the domain it resolved.
 */
export async function fetchCollectionStatsHistory(
  token: string,
  collectionId: string,
  span?: { start: string; end: string } | null,
): Promise<CollectionStatsHistory> {
  const query = span
    ? `?start=${encodeURIComponent(span.start)}&end=${encodeURIComponent(span.end)}`
    : "";
  return apiFetch<CollectionStatsHistory>(
    `/api/collections/${collectionId}/stats/history${query}`,
    { token },
  );
}

export async function getCollectionPrompt(
  token: string,
  collectionId: string,
): Promise<PromptSelection> {
  return apiFetch<PromptSelection>(`/api/collections/${collectionId}/prompt`, { token });
}

export async function getBasePrompt(token: string): Promise<PromptSelection> {
  return apiFetch<PromptSelection>("/api/chat/prompt", { token });
}

export async function updateCollectionPrompt(
  token: string,
  collectionId: string,
  payload: PromptSelectionUpdatePayload,
): Promise<PromptSelection> {
  return apiFetch<PromptSelection>(`/api/collections/${collectionId}/prompt`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updateBasePrompt(
  token: string,
  payload: PromptSelectionUpdatePayload,
): Promise<PromptSelection> {
  return apiFetch<PromptSelection>("/api/chat/prompt", {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
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

export async function fetchCollectionIndexes(
  token: string,
  collectionId: string,
): Promise<CollectionIndexesRead> {
  return apiFetch<CollectionIndexesRead>(`/api/collections/${collectionId}/indexes`, { token });
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

export async function runCollectionQuery(
  token: string,
  collectionId: string,
  payload: CollectionQueryRequest,
): Promise<CollectionQueryResult> {
  return apiFetch<CollectionQueryResult>(`/api/collections/${collectionId}/query`, {
    method: "POST",
    body: JSON.stringify(payload),
    token,
  });
}

export async function fetchCollectionQueryArguments(
  token: string,
  collectionId: string,
): Promise<CollectionQueryArgumentsResponse> {
  return apiFetch<CollectionQueryArgumentsResponse>(
    `/api/collections/${collectionId}/query-arguments`,
    { token },
  );
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

export async function fetchDocumentFocusedTrace(
  token: string,
  documentId: string,
  chunkId: string,
): Promise<DocumentTrace> {
  const params = `?chunk_id=${encodeURIComponent(chunkId)}`;
  return apiFetch<DocumentTrace>(`/api/documents/${documentId}/trace/full${params}`, { token });
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

/**
 * Fetch a stored asset a retrieval match references (an indexed image) as a
 * Blob. The path is the storage-relative one carried on the match's
 * `ragworks.image_asset` metadata.
 */
export async function fetchCollectionAssetBlob(
  token: string,
  collectionId: string,
  assetPath: string,
): Promise<Blob> {
  const encoded = assetPath.split("/").map(encodeURIComponent).join("/");
  return apiFetchBlob(`/api/collections/${collectionId}/assets/${encoded}`, token);
}
