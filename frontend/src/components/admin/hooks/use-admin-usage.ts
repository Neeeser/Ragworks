"use client";

import { useState } from "react";

import { fetchAdminUsageSummary, fetchAdminUsageTimeseries } from "@/lib/api";
import { useApiQuery } from "@/lib/use-api-query";
import { useAuth } from "@/providers/auth-provider";

export const USAGE_WINDOWS = [7, 30, 90] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

/** Owns the usage dashboard's window selection and its two data loads. */
export function useAdminUsage() {
  const { token } = useAuth();
  const [windowDays, setWindowDays] = useState<UsageWindow>(30);

  const summary = useApiQuery(
    () => fetchAdminUsageSummary(token ?? "", windowDays),
    [token, windowDays],
    { enabled: Boolean(token) },
  );
  const timeseries = useApiQuery(
    () => fetchAdminUsageTimeseries(token ?? "", windowDays),
    [token, windowDays],
    { enabled: Boolean(token) },
  );

  return {
    windowDays,
    setWindowDays,
    summary: summary.data,
    points: timeseries.data?.points ?? [],
    loading: summary.loading || timeseries.loading,
    error: summary.error || timeseries.error,
  };
}
