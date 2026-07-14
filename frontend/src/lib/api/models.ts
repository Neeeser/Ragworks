import { apiFetch } from "@/lib/api/client";

import type { ListModelEndpointsResponse, ModelCatalogResponse, UUID } from "@/lib/types";

export async function listChatModels(token: string): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>("/api/models?kind=chat", { token });
}

export async function fetchEmbeddingModels(token: string): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>("/api/models?kind=embedding", { token });
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
