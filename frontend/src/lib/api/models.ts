import { apiFetch } from "@/lib/api/client";

import type {
  EmbeddingDimensionResponse,
  ListModelEndpointsResponse,
  ModelCatalogResponse,
  ModelShortlistEntry,
  ModelShortlistIdentity,
  ModelShortlistResponse,
  ShortlistKind,
  UUID,
} from "@/lib/types";

const REFRESH_QUERY = "&refresh=true";

export async function listChatModels(
  token: string,
  refresh = false,
): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>(`/api/models?kind=chat${refresh ? REFRESH_QUERY : ""}`, {
    token,
  });
}

export async function fetchEmbeddingModels(
  token: string,
  refresh = false,
): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>(
    `/api/models?kind=embedding${refresh ? REFRESH_QUERY : ""}`,
    { token },
  );
}

export async function fetchRerankingModels(
  token: string,
  refresh = false,
): Promise<ModelCatalogResponse> {
  return apiFetch<ModelCatalogResponse>(
    `/api/models?kind=reranking${refresh ? REFRESH_QUERY : ""}`,
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

export async function fetchModelShortlist(
  token: string,
  kind: ShortlistKind,
): Promise<ModelShortlistResponse> {
  return apiFetch<ModelShortlistResponse>(`/api/models/shortlist?kind=${kind}`, { token });
}

export async function pinModel(
  token: string,
  identity: ModelShortlistIdentity,
): Promise<ModelShortlistEntry> {
  return apiFetch<ModelShortlistEntry>("/api/models/shortlist/pins", {
    token,
    method: "PUT",
    body: JSON.stringify(identity),
  });
}

export async function unpinModel(token: string, identity: ModelShortlistIdentity): Promise<void> {
  await apiFetch<void>("/api/models/shortlist/pins", {
    token,
    method: "DELETE",
    body: JSON.stringify(identity),
  });
}

export async function recordModelUse(
  token: string,
  identity: ModelShortlistIdentity,
): Promise<ModelShortlistEntry> {
  return apiFetch<ModelShortlistEntry>("/api/models/shortlist/recents", {
    token,
    method: "POST",
    body: JSON.stringify(identity),
  });
}
