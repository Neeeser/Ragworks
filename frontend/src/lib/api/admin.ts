import { apiFetch } from "@/lib/api/client";

import type {
  AdminUsageSummary,
  AdminUsageTimeseries,
  AdminUser,
  AdminUserUpdate,
  DiagnosticsBundle,
} from "@/lib/types";

export function fetchAdminUsers(token: string): Promise<AdminUser[]> {
  return apiFetch<AdminUser[]>("/api/admin/users", { token });
}

export function updateAdminUser(
  token: string,
  userId: string,
  patch: AdminUserUpdate,
): Promise<AdminUser> {
  return apiFetch<AdminUser>(`/api/admin/users/${userId}`, {
    token,
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function fetchAdminUsageSummary(token: string, days: number): Promise<AdminUsageSummary> {
  return apiFetch<AdminUsageSummary>(`/api/admin/usage/summary?days=${days}`, { token });
}

export function fetchAdminUsageTimeseries(
  token: string,
  days: number,
): Promise<AdminUsageTimeseries> {
  return apiFetch<AdminUsageTimeseries>(`/api/admin/usage/timeseries?days=${days}`, { token });
}

/** Fetch the diagnostics bundle (recent redacted backend log records). */
export function fetchAdminDiagnostics(token: string): Promise<DiagnosticsBundle> {
  return apiFetch<DiagnosticsBundle>("/api/admin/diagnostics/export", { token });
}
