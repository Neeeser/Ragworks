import { apiFetch } from "@/lib/api/client";

import type {
  BackendInfo,
  IndexBackend,
  IndexCreatePayload,
  NodeSpec,
  Pipeline,
  PipelineDefinition,
  PipelineKind,
  PipelineValidationResult,
  PipelineVersion,
  VectorIndex,
} from "@/lib/types";

export async function fetchPipelines(token: string, kind?: PipelineKind): Promise<Pipeline[]> {
  const params = kind ? `?kind=${kind}` : "";
  return apiFetch<Pipeline[]>(`/api/pipelines${params}`, { token });
}

export async function fetchPipeline(token: string, pipelineId: string): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}`, { token });
}

export async function fetchPipelineNodes(token: string): Promise<NodeSpec[]> {
  const response = await apiFetch<{ nodes: NodeSpec[] }>("/api/pipelines/nodes", { token });
  return response.nodes;
}

export async function listIndexes(token: string, backend?: IndexBackend): Promise<VectorIndex[]> {
  const params = backend ? `?backend=${backend}` : "";
  const response = await apiFetch<{ indexes: VectorIndex[] }>(`/api/indexes${params}`, { token });
  return response.indexes ?? [];
}

export async function fetchIndexBackends(token: string): Promise<BackendInfo[]> {
  const response = await apiFetch<{ backends: BackendInfo[] }>("/api/indexes/backends", { token });
  return response.backends ?? [];
}

export async function describeIndex(
  token: string,
  backend: IndexBackend,
  indexName: string,
): Promise<VectorIndex> {
  return apiFetch<VectorIndex>(`/api/indexes/${indexName}?backend=${backend}`, { token });
}

export async function createIndex(
  token: string,
  payload: IndexCreatePayload,
): Promise<VectorIndex> {
  return apiFetch<VectorIndex>("/api/indexes", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function deleteIndex(
  token: string,
  backend: IndexBackend,
  indexName: string,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/indexes/${indexName}?backend=${backend}`, {
    method: "DELETE",
    token,
  });
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
  token: string,
  pipelineId: string,
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
  token: string,
  pipelineId: string,
): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/pipelines/${pipelineId}`, {
    method: "DELETE",
    token,
  });
}

export async function listPipelineVersions(
  token: string,
  pipelineId: string,
): Promise<PipelineVersion[]> {
  return apiFetch<PipelineVersion[]>(`/api/pipelines/${pipelineId}/versions`, { token });
}

export async function activatePipelineVersion(
  token: string,
  pipelineId: string,
  version: number,
): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}/activate`, {
    method: "POST",
    token,
    body: JSON.stringify({ version }),
  });
}
