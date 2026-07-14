import { apiFetch } from "@/lib/api/client";

import type {
  ConnectionCreateRequest,
  ConnectionUpdateRequest,
  ConnectionValidationResult,
  ProviderConnection,
  ProviderTypeInfo,
  UUID,
} from "@/lib/types";

export async function listProviderTypes(token: string): Promise<ProviderTypeInfo[]> {
  return apiFetch<ProviderTypeInfo[]>("/api/providers", { token });
}

export async function listConnections(token: string): Promise<ProviderConnection[]> {
  return apiFetch<ProviderConnection[]>("/api/connections", { token });
}

export async function createConnection(
  token: string,
  payload: ConnectionCreateRequest,
): Promise<ProviderConnection> {
  return apiFetch<ProviderConnection>("/api/connections", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function updateConnection(
  token: string,
  connectionId: UUID,
  payload: ConnectionUpdateRequest,
): Promise<ProviderConnection> {
  return apiFetch<ProviderConnection>(`/api/connections/${connectionId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(payload),
  });
}

export async function deleteConnection(token: string, connectionId: UUID): Promise<void> {
  return apiFetch<void>(`/api/connections/${connectionId}`, { method: "DELETE", token });
}

export async function validateConnectionConfig(
  token: string,
  providerType: string,
  config: Record<string, string>,
): Promise<ConnectionValidationResult> {
  return apiFetch<ConnectionValidationResult>("/api/connections/validate", {
    method: "POST",
    token,
    body: JSON.stringify({ provider_type: providerType, config }),
  });
}

export async function validateConnection(
  token: string,
  connectionId: UUID,
): Promise<ConnectionValidationResult> {
  return apiFetch<ConnectionValidationResult>(`/api/connections/${connectionId}/validate`, {
    method: "POST",
    token,
  });
}
