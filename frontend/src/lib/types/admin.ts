import type { UserRole, UUID } from "./common";

export interface AdminUser {
  id: UUID;
  email: string;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  collection_count: number;
  document_count: number;
}

export interface AdminUserUpdate {
  role?: UserRole;
  is_active?: boolean;
}

export interface AdminUserUsage {
  user_id: UUID;
  email: string;
  turns: number;
  total_tokens: number;
  cost: number;
  last_active: string;
}

export interface AdminUsageSummary {
  window_days: number;
  total_turns: number;
  total_tokens: number;
  total_cost: number;
  active_users: number;
  event_counts: Record<string, number>;
  users: AdminUserUsage[];
}

export interface AdminUsagePoint {
  day: string;
  turns: number;
  total_tokens: number;
}

export interface AdminUsageTimeseries {
  window_days: number;
  points: AdminUsagePoint[];
}

/** Mirrors `app/schemas/observability.py::DiagnosticsMetadata`. */
export interface DiagnosticsMetadata {
  generated_at: string;
  debug: boolean;
  log_level: string | null;
  record_count: number;
  buffer_capacity: number;
  note: string;
}

/** Mirrors `app/schemas/observability.py::DiagnosticsBundle`. */
export interface DiagnosticsBundle {
  metadata: DiagnosticsMetadata;
  records: Array<Record<string, unknown>>;
}
