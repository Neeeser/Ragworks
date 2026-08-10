import { apiFetch } from "@/lib/api/client";

import type {
  UsageBucket,
  UsageEventPage,
  UsageGroupBy,
  UsageKind,
  UsageSummaryRead,
  UsageSurface,
} from "@/lib/types";

/**
 * Which ledger a read addresses. The two prefixes serve identical shapes; the
 * admin one additionally honours `user_id` and covers every account, so the
 * scope is a parameter rather than a second pair of functions that would drift.
 */
export type UsageScope = "user" | "admin";

const PREFIX: Record<UsageScope, string> = {
  user: "/api/usage",
  admin: "/api/admin/usage/ledger",
};

export interface UsageSummaryParams {
  start: string;
  end: string;
  group_by: UsageGroupBy;
  bucket: UsageBucket;
  /** Admin scope only — the per-user routes always scope to the caller. */
  user_id?: string | null;
}

export interface UsageEventParams {
  start: string;
  end: string;
  kind?: UsageKind | null;
  surface?: UsageSurface | null;
  connection_id?: string | null;
  model?: string | null;
  user_id?: string | null;
  limit: number;
  offset: number;
}

/** Drop absent filters rather than sending empty strings the API would match on. */
function toQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    search.set(key, String(value));
  });
  return search.toString();
}

export function fetchUsageSummary(
  token: string,
  scope: UsageScope,
  params: UsageSummaryParams,
): Promise<UsageSummaryRead> {
  return apiFetch<UsageSummaryRead>(`${PREFIX[scope]}/summary?${toQuery({ ...params })}`, {
    token,
  });
}

export function fetchUsageEvents(
  token: string,
  scope: UsageScope,
  params: UsageEventParams,
): Promise<UsageEventPage> {
  return apiFetch<UsageEventPage>(`${PREFIX[scope]}/events?${toQuery({ ...params })}`, { token });
}
