"use client";

import { useCallback, useState } from "react";

import { fetchUsageEvents } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

import { drilldownFilters } from "../lib/drilldown";

import type { UsageSelection } from "../lib/drilldown";
import type { UsageScope } from "@/lib/api";

export const EVENTS_PAGE_SIZE = 25;

/**
 * The drill-down list: which breakdown row is open, and its page of events.
 *
 * Selecting a different row resets to the first page — keeping the offset
 * would open a new filter part-way through a list the reader has not seen.
 */
export function useUsageEvents(
  scope: UsageScope,
  range: { start: string; end: string },
  scopedUserId: string | null,
) {
  const { token } = useAuth();
  const [selection, setSelection] = useState<UsageSelection | null>(null);
  const [offset, setOffset] = useState(0);

  const select = useCallback((next: UsageSelection | null) => {
    setSelection(next);
    setOffset(0);
  }, []);

  const filters = selection ? drilldownFilters(selection) : null;
  const key = filters ? JSON.stringify(filters) : "";

  const page = useApiQuery(
    () =>
      fetchUsageEvents(token ?? "", scope, {
        start: range.start,
        end: range.end,
        user_id: scopedUserId,
        ...filters,
        limit: EVENTS_PAGE_SIZE,
        offset,
      }),
    [token, scope, `${range.start}|${range.end}|${scopedUserId ?? ""}`, key, offset],
    { enabled: Boolean(token) && filters !== null },
  );

  const total = page.data?.total ?? 0;
  return {
    selection,
    select,
    events: page.data?.events ?? [],
    total,
    offset,
    loading: page.loading,
    error: page.error,
    hasPrevious: offset > 0,
    hasNext: offset + EVENTS_PAGE_SIZE < total,
    previous: () => setOffset((current) => Math.max(0, current - EVENTS_PAGE_SIZE)),
    next: () => setOffset((current) => current + EVENTS_PAGE_SIZE),
  };
}
