import type { ModelPricing } from "@/lib/types/chat";
import type { UUID } from "@/lib/types/common";

/** Mirrors `app/schemas/enums.py::ProviderType`. */
export type ProviderType = "openrouter" | "ollama" | "pinecone";

/** Mirrors `app/schemas/enums.py::ProviderKind`. */
export type ProviderKind = "embedding" | "chat" | "vector_store";

/** Mirrors `app/schemas/providers.py::ConfigFieldKind`. */
export type ProviderConfigFieldKind = "string" | "secret" | "url";

/** Mirrors `app/schemas/providers.py::ProviderConfigField`. */
export interface ProviderConfigField {
  name: string;
  label: string;
  kind: ProviderConfigFieldKind;
  required: boolean;
  placeholder?: string | null;
  description?: string | null;
}

/** Mirrors `app/schemas/providers.py::ProviderTypeRead` (`GET /api/providers`). */
export interface ProviderTypeInfo {
  provider_type: string;
  label: string;
  kinds: ProviderKind[];
  config_fields: ProviderConfigField[];
  docs_url?: string | null;
  max_connections_per_user?: number | null;
  recommended: boolean;
  builtin: boolean;
  available: boolean;
}

/** Mirrors `app/schemas/providers.py::ConnectionRead` — secrets never included. */
export interface ProviderConnection {
  id: UUID;
  provider_type: ProviderType;
  label: string;
  kinds: ProviderKind[];
  config: Record<string, string>;
  secrets_configured: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

/** Mirrors `app/schemas/providers.py::ConnectionCreate`. */
export interface ConnectionCreateRequest {
  provider_type: string;
  label: string;
  config: Record<string, string>;
}

/** Mirrors `app/schemas/providers.py::ConnectionUpdate`. */
export interface ConnectionUpdateRequest {
  label?: string;
  config?: Record<string, string>;
}

/** Mirrors `app/schemas/providers.py::ConnectionValidationResult`. */
export interface ConnectionValidationResult {
  valid: boolean;
  message?: string | null;
}

/** Mirrors `app/schemas/providers.py::CatalogModel` — a model qualified by its connection. */
export interface CatalogModel {
  connection_id: UUID;
  connection_label: string;
  provider_type: ProviderType;
  id: string;
  name: string;
  description?: string | null;
  context_length?: number | null;
  pricing?: ModelPricing | null;
  dimension?: number | null;
  supported_parameters: string[];
  default_parameters?: Record<string, unknown> | null;
}

/** Mirrors `app/schemas/providers.py::ConnectionCatalogError`. */
export interface ConnectionCatalogError {
  connection_id: UUID;
  connection_label: string;
  message: string;
}

/** Mirrors `app/schemas/providers.py::CatalogMetadata`. */
export interface CatalogMetadata {
  freshness: "fresh" | "stale";
  age_seconds: number;
  refreshing: boolean;
  warning?: string | null;
}

/** Mirrors `app/schemas/providers.py::ModelCatalogResponse` (`GET /api/models`). */
export interface ModelCatalogResponse {
  models: CatalogModel[];
  connection_errors: ConnectionCatalogError[];
  meta: CatalogMetadata;
}

/** Mirrors `app/schemas/providers.py::EmbeddingDimensionResponse`. */
export interface EmbeddingDimensionResponse {
  connection_id: UUID;
  model_id: string;
  dimension?: number | null;
}
