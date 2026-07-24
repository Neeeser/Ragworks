import type { UUID } from "@/lib/types/common";

/**
 * API key wire types, hand-mirrored from `app/schemas/api_keys.py`. Keys are
 * the credential an agent harness holds for a collection's MCP endpoint.
 */

/** Mirrors `app/schemas/enums.py::ApiKeyCapability`. */
export type ApiKeyCapability = "tools:invoke" | "files:read" | "files:write";

/** Mirrors `ApiKeyRead` — never carries the secret. */
export interface ApiKey {
  id: UUID;
  name: string;
  prefix: string;
  capabilities: ApiKeyCapability[];
  all_collections: boolean;
  collection_ids: UUID[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/** Mirrors `ApiKeyCreate`. */
export interface ApiKeyCreatePayload {
  name: string;
  capabilities: ApiKeyCapability[];
  all_collections?: boolean;
  collection_ids?: UUID[];
  expires_in_days?: number | null;
}

/** Mirrors `ApiKeyCreated` — the one shape carrying the plaintext secret. */
export interface ApiKeyCreated {
  key: ApiKey;
  secret: string;
}

/** Mirrors `ApiKeyList`. */
export interface ApiKeyListResponse {
  keys: ApiKey[];
}
