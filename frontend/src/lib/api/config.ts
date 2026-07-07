import { apiFetch } from "@/lib/api/client";

import type { AppConfigUpdate, ConfigFieldRead, PublicConfig } from "@/lib/types";

/** Unauthenticated: `GET /api/config` is served to anonymous visitors too. */
export function fetchPublicConfig(): Promise<PublicConfig> {
  return apiFetch<PublicConfig>("/api/config");
}

export function fetchAdminConfig(token: string): Promise<ConfigFieldRead[]> {
  return apiFetch<ConfigFieldRead[]>("/api/admin/config", { token });
}

export function updateAdminConfig(
  token: string,
  patch: AppConfigUpdate,
): Promise<ConfigFieldRead[]> {
  return apiFetch<ConfigFieldRead[]>("/api/admin/config", {
    token,
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
