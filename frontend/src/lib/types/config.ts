import type { IndexBackend } from "@/lib/types/common";

/**
 * Runtime application config wire types, hand-mirrored from
 * `app/schemas/app_config.py` (public shape) and `app/schemas/admin.py`
 * (admin catalog shape). Keep these in lockstep with the backend schemas.
 */

export interface PublicAuthConfig {
  allow_registration: boolean;
}

export interface PublicUploadConfig {
  max_upload_size_mb: number;
  allowed_content_types: string[];
}

export interface PublicIndexingConfig {
  default_backend: IndexBackend;
}

export interface PublicFeatureFlags {
  umap_visualizations: boolean;
  chat_branching: boolean;
}

export interface PublicConfig {
  auth: PublicAuthConfig;
  uploads: PublicUploadConfig;
  indexing: PublicIndexingConfig;
  features: PublicFeatureFlags;
}

export type ConfigFieldKind = "bool" | "int" | "string" | "string_list" | "select" | "multi_select";

export type ConfigSource = "default" | "db" | "env-locked";

export interface ConfigFieldOption {
  value: string;
  label: string;
}

export interface ConfigFieldRead {
  key: string;
  label: string;
  description: string;
  kind: ConfigFieldKind;
  public: boolean;
  env_var: string | null;
  options: ConfigFieldOption[] | null;
  min_value: number | null;
  max_value: number | null;
  value: unknown;
  default: unknown;
  source: ConfigSource;
}

/** Sparse nested PATCH body: `{ section: { leaf: value_or_null } }`. */
export type AppConfigUpdate = Record<string, Record<string, unknown>>;
