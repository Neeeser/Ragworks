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
