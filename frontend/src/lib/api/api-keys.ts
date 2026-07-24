import { apiFetch } from "@/lib/api/client";

import type { ApiKeyCreated, ApiKeyCreatePayload, ApiKeyListResponse } from "@/lib/types/api-keys";
import type { UUID } from "@/lib/types/common";

export async function listApiKeys(token: string): Promise<ApiKeyListResponse> {
  return apiFetch<ApiKeyListResponse>("/api/api-keys", { token });
}

export async function createApiKey(
  token: string,
  payload: ApiKeyCreatePayload,
): Promise<ApiKeyCreated> {
  return apiFetch<ApiKeyCreated>("/api/api-keys", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function revokeApiKey(token: string, keyId: UUID): Promise<void> {
  await apiFetch<void>(`/api/api-keys/${keyId}`, { method: "DELETE", token });
}
