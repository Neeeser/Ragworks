import { apiFetch } from "@/lib/api/client";

import type { AdminUser, AdminUserUpdate } from "@/lib/types";

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
