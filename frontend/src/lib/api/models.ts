import { apiFetch, type FetchOptions } from "@/lib/api/client";

import type { EmbeddingModelInfo, ListModelEndpointsResponse, ModelInfo } from "@/lib/types";

export async function fetchEmbeddingModels(
  token: string,
  refresh?: boolean,
): Promise<EmbeddingModelInfo[]> {
  const params = refresh ? "?refresh=true" : "";
  return apiFetch<EmbeddingModelInfo[]>(`/api/models/embeddings${params}`, { token });
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
  token: string | undefined,
  author: string,
  slug: string,
): Promise<ListModelEndpointsResponse> {
  const encodedAuthor = encodeURIComponent(author);
  const encodedSlug = encodeURIComponent(slug);
  const options: FetchOptions = {};
  if (token) {
    options.token = token;
  }
  return apiFetch<ListModelEndpointsResponse>(
    `/api/models/${encodedAuthor}/${encodedSlug}/endpoints`,
    options,
  );
}
