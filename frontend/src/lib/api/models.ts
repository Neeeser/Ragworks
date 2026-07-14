import { apiFetch } from "@/lib/api/client";

import type {
  EmbeddingDimensionResponse,
  ListModelEndpointsResponse,
  ModelCatalogResponse,
  UUID,
} from "@/lib/types";

export async function listChatModels(
  token: string,
  refresh = false,
): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>(`/api/models?kind=chat${refresh ? "&refresh=true" : ""}`, {
    token,
  });
}

export async function fetchEmbeddingModels(
  token: string,
  refresh = false,
): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>(
    `/api/models?kind=embedding${refresh ? "&refresh=true" : ""}`,
    { token },
  );
}

export async function fetchEmbeddingDimension(
  token: string,
  connectionId: UUID,
  modelId: string,
): Promise<EmbeddingDimensionResponse> {
  return apiFetch<EmbeddingDimensionResponse>(
    `/api/connections/${connectionId}/models/embedding-dimension?model_id=${encodeURIComponent(modelId)}`,
    { token },
  );
}

export async function listModelEndpoints(
  token: string,
  connectionId: UUID,
  author: string,
  slug: string,
): Promise<ListModelEndpointsResponse> {
  const encodedAuthor = encodeURIComponent(author);
  const encodedSlug = encodeURIComponent(slug);
  return apiFetch<ListModelEndpointsResponse>(
    `/api/connections/${connectionId}/models/${encodedAuthor}/${encodedSlug}/endpoints`,
    { token },
  );
}
