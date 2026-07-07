import type { PublicConfig } from "@/lib/types";

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
