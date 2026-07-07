import type { ConfigFieldRead, PublicConfig } from "@/lib/types";

/** Matches backend code defaults (`app/schemas/app_config.py`): open/enabled. */
export function makePublicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    auth: { allow_registration: true },
    uploads: {
      max_upload_size_mb: 50,
      allowed_content_types: ["text/plain", "text/markdown", "text/csv", "application/pdf"],
    },
    features: {
      umap_visualizations: true,
      chat_branching: true,
    },
    ...overrides,
  };
}

/** One admin config catalog entry (`app/schemas/admin.py: ConfigFieldRead`). */
export function makeConfigField(overrides: Partial<ConfigFieldRead> = {}): ConfigFieldRead {
  return {
    key: "auth.allow_registration",
    label: "Allow sign-ups",
    description: "When off, new account registration is disabled.",
    kind: "bool",
    public: true,
    env_var: null,
    value: true,
    default: true,
    source: "default",
    ...overrides,
  };
}
