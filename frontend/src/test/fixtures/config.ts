import type {
  AdminUsageSummary,
  AdminUsageTimeseries,
  ConfigFieldRead,
  PublicConfig,
} from "@/lib/types";

/** Matches backend code defaults (`app/schemas/app_config.py`): open/enabled. */
export function makePublicConfig(overrides: Partial<PublicConfig> = {}): PublicConfig {
  return {
    auth: { allow_registration: true },
    uploads: {
      max_upload_size_mb: 50,
      allowed_content_types: ["text/plain", "text/markdown", "text/csv", "application/pdf"],
    },
    indexing: {
      default_backend: "pgvector",
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

export function makeAdminUsageSummary(
  overrides: Partial<AdminUsageSummary> = {},
): AdminUsageSummary {
  return {
    window_days: 30,
    total_turns: 12,
    total_tokens: 3400,
    total_cost: 0.42,
    active_users: 2,
    event_counts: { "chat.turn_completed": 12 },
    users: [
      {
        user_id: "11111111-1111-4111-8111-111111111111",
        email: "alice@example.com",
        turns: 8,
        total_tokens: 3000,
        cost: 0.4,
        last_active: "2026-07-06T12:00:00Z",
      },
      {
        user_id: "22222222-2222-4222-8222-222222222222",
        email: "bob@example.com",
        turns: 4,
        total_tokens: 400,
        cost: 0.02,
        last_active: "2026-07-05T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

export function makeAdminUsageTimeseries(
  overrides: Partial<AdminUsageTimeseries> = {},
): AdminUsageTimeseries {
  return {
    window_days: 30,
    points: [
      { day: "2026-07-05T00:00:00Z", turns: 4, total_tokens: 400 },
      { day: "2026-07-06T00:00:00Z", turns: 8, total_tokens: 3000 },
    ],
    ...overrides,
  };
}
