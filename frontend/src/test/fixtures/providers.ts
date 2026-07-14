import type {
  CatalogModel,
  ConnectionCatalogError,
  ModelCatalogResponse,
  ProviderConnection,
  ProviderTypeInfo,
} from "@/lib/types";

const OPENROUTER_CONNECTION_ID = "conn-openrouter-1";

export function makeConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: OPENROUTER_CONNECTION_ID,
    provider_type: "openrouter",
    label: "OpenRouter",
    kinds: ["embedding", "chat"],
    config: {},
    secrets_configured: { api_key: true },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeProviderType(overrides: Partial<ProviderTypeInfo> = {}): ProviderTypeInfo {
  return {
    provider_type: "openrouter",
    label: "OpenRouter",
    kinds: ["embedding", "chat"],
    config_fields: [
      {
        name: "api_key",
        label: "API key",
        kind: "secret",
        required: true,
        placeholder: "sk-or-...",
      },
    ],
    docs_url: "https://openrouter.ai/settings/keys",
    max_connections_per_user: null,
    recommended: true,
    builtin: false,
    available: true,
    ...overrides,
  };
}

export function makeCatalogModel(overrides: Partial<CatalogModel> = {}): CatalogModel {
  return {
    connection_id: OPENROUTER_CONNECTION_ID,
    connection_label: "OpenRouter",
    provider_type: "openrouter",
    id: "model-1",
    name: "Model One",
    description: null,
    context_length: 8192,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    dimension: null,
    supported_parameters: ["tools", "temperature"],
    ...overrides,
  };
}

export function makeModelCatalog(
  models: CatalogModel[] = [makeCatalogModel()],
  connectionErrors: ConnectionCatalogError[] = [],
): ModelCatalogResponse {
  return { models, connection_errors: connectionErrors };
}
