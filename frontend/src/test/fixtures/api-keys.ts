import type { ApiKey } from "@/lib/types/api-keys";

export function makeApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "key-1",
    name: "Research agent",
    prefix: "rw_ab12cd34",
    capabilities: ["tools:invoke"],
    collection_ids: ["col-1"],
    created_at: "2026-07-01T10:00:00Z",
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}
