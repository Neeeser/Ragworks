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
