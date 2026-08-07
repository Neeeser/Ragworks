import { apiFetch } from "@/lib/api/client";

import type {
  BackendInfo,
  HuggingFaceTokenizerDownload,
  IndexBackend,
  IndexCreatePayload,
  IndexRegisterPayload,
  NodeSpec,
  Pipeline,
  PipelineDefinition,
  PipelineKind,
  PipelineValidationResult,
  PipelineVersion,
  ToolTemplate,
  ToolTemplateScaffoldRequest,
  VectorIndex,
} from "@/lib/types";

export async function ensureHuggingFaceTokenizer(
  token: string,
  payload: HuggingFaceTokenizerDownload,
): Promise<{ model_id: string; cached: boolean }> {
  return apiFetch("/api/tokenizers/huggingface", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

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

export async function fetchToolTemplates(token: string): Promise<ToolTemplate[]> {
  const response = await apiFetch<{ templates: ToolTemplate[] }>("/api/pipelines/tool-templates", {
    token,
  });
  return response.templates;
}

export async function scaffoldToolTemplate(
  token: string,
  templateId: string,
  choices: ToolTemplateScaffoldRequest,
): Promise<PipelineDefinition> {
  return apiFetch<PipelineDefinition>(`/api/pipelines/tool-templates/${templateId}`, {
    token,
    method: "POST",
    body: JSON.stringify(choices),
  });
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

export async function registerIndex(
  token: string,
  payload: IndexRegisterPayload,
): Promise<VectorIndex> {
  return apiFetch<VectorIndex>("/api/indexes/register", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function unregisterIndex(token: string, indexId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/indexes/registrations/${indexId}`, {
    method: "DELETE",
    token,
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
    /** Accepted for wire compatibility; capability is derived from the graph. */
    kind?: PipelineKind;
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

export async function copyPipeline(
  token: string,
  pipelineId: string,
  name?: string,
): Promise<Pipeline> {
  return apiFetch<Pipeline>(`/api/pipelines/${pipelineId}/copy`, {
    method: "POST",
    token,
    body: JSON.stringify({ name: name ?? null }),
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
