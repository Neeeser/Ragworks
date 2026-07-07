export type UUID = string;

export type RunSettingsSectionKey =
  | "systemPrompt"
  | "collectionTools"
  | "streaming"
  | "modelRouting"
  | "providerRouting"
  | "modelParameters"
  | "vitals"
  | "usage";

export type UserRole = "admin" | "user";

export interface User {
  id: UUID;
  email: string;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
  openrouter_configured: boolean;
  pinecone_configured: boolean;
  last_used_chat_model?: string | null;
  last_used_parameters?: Record<string, unknown> | null;
  last_used_provider?: ProviderPreferences | null;
  last_used_stream?: boolean | null;
  last_used_tool_collection_ids?: UUID[] | null;
  run_settings_order?: RunSettingsSectionKey[] | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderKeyStatus {
  configured: boolean;
  valid: boolean;
  message?: string | null;
}

export interface UserKeyValidation {
  openrouter: ProviderKeyStatus;
  pinecone: ProviderKeyStatus;
}

export type ProviderSortOption = "price" | "throughput" | "latency";

export interface ProviderMaxPrice {
  prompt?: number;
  completion?: number;
  request?: number;
  image?: number;
}

export interface ProviderPreferences {
  order?: string[];
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
  data_collection?: "allow" | "deny";
  zdr?: boolean;
  enforce_distillable_text?: boolean;
  only?: string[];
  ignore?: string[];
  quantizations?: string[];
  sort?: ProviderSortOption;
  max_price?: ProviderMaxPrice;
}

/**
 * Canonical union of parameter-input widget kinds. Shared by the model-parameter
 * definitions in `lib/chat-parameters.ts` and the generic parameter control
 * components in `components/ui/parameter-controls.tsx` — previously maintained
 * as two near-identical unions (`ParameterInputKind` / `ParameterInputType`).
 */
export type ParameterInputKind =
  | "number"
  | "integer"
  | "boolean"
  | "list"
  | "json"
  | "select"
  | "text";
